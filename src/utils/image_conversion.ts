import { Worker } from "node:worker_threads";
import zlib from "node:zlib";

import sharp from "sharp";

/**
 * Colour-space normalisation for uploaded images.
 *
 * The problem this solves: GPT-Image-2.5 rejects a photo carrying an explicit
 * wide-gamut ICC profile with "Invalid image file or mode". The 15 Sept audit
 * found 50 such photos in training_images -- 48 Display P3, 2 Adobe RGB -- and
 * a pet is unusable if even one of its references is bad, because they all go
 * in one request.
 *
 * The rule the data supports, and it is not the obvious one: an ABSENT profile
 * is fine, an EXPLICIT non-sRGB profile is fatal. Wizard Test 7's photos carry
 * no profile at all and passed 13/13; Max test 6's are all Display P3 and
 * failed 13/13. So this converts only what is actually wrong and leaves
 * everything else byte-identical.
 *
 * Do not classify with `sips -g profile`. It reports the ASSUMED colour space
 * and calls a no-profile file "sRGB IEC61966-2.1", which merges the bucket
 * that works into the bucket that does not.
 */

const ACCEPTED_FORMATS = new Set(["image/png", "image/jpeg", "image/webp"]);

// Verified on a real Display P3 photo: the result reads back as sRGB from both
// sips and the parser below. .rotate() bakes EXIF orientation into the pixels
// before withMetadata drops it -- without it, photos that relied on the
// orientation tag come out sideways.
const JPEG_QUALITY = 92;

/** Thrown for input no amount of converting will fix. Carries the filename so
 * the API can tell the customer which of their photos to replace. */
export class UnsupportedImageError extends Error {
  readonly filename: string;
  readonly format: string;

  constructor(filename: string, format: string, message: string) {
    super(message);
    this.name = "UnsupportedImageError";
    this.filename = filename;
    this.format = format;
  }
}

/**
 * What the bytes actually are, regardless of what the filename or the
 * Content-Type claims. An iPhone photo saved as ".jpg" is very often still
 * HEIC inside, and file.mimetype repeats whatever the browser guessed.
 */
export const sniffFormat = (bytes: Buffer): string => {
  if (bytes.length < 12) return "too short to identify";
  if (bytes[0] === 0x89 && bytes.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.toString("latin1", 0, 4) === "GIF8") return "image/gif";

  // ISO base media container: the brand at offset 8 says which flavour.
  if (bytes.toString("latin1", 4, 8) === "ftyp") {
    const brand = bytes.toString("latin1", 8, 12);
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return "image/heic";
    if (brand === "avif") return "image/avif";
    return `iso container, brand ${brand}`;
  }

  return "unrecognised";
};

/** Pull the embedded ICC profile out of a JPEG. It can be split across several
 * APP2 segments, so they are collected in sequence order and concatenated. */
const jpegIccProfile = (bytes: Buffer): Buffer | null => {
  const chunks: Array<{ seq: number; data: Buffer }> = [];
  let offset = 2;

  while (offset < bytes.length - 4) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan, end of image

    const length = bytes.readUInt16BE(offset + 2);
    if (
      marker === 0xe2 &&
      bytes.toString("latin1", offset + 4, offset + 15) === "ICC_PROFILE"
    ) {
      chunks.push({
        seq: bytes[offset + 16],
        data: bytes.subarray(offset + 18, offset + 2 + length),
      });
    }
    offset += 2 + length;
  }

  if (!chunks.length) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  return Buffer.concat(chunks.map((chunk) => chunk.data));
};

/**
 * The profile's human-readable name, from its 'desc' tag.
 *
 * ICC v4 stores it as 'mluc', whose strings are UTF-16BE; Node only decodes
 * LE, hence the swap. Within an mluc record the LENGTH is at offset 20 and the
 * OFFSET at 24 -- reading them at 16 and 20 returns mojibake that still starts
 * with the right words, which is a bug a spot check will happily pass.
 */
export const iccDescription = (profile: Buffer): string | null => {
  if (profile.length < 132) return null;
  const tagCount = profile.readUInt32BE(128);

  for (let i = 0; i < tagCount; i += 1) {
    const entry = 132 + i * 12;
    if (entry + 12 > profile.length) break;
    if (profile.toString("latin1", entry, entry + 4) !== "desc") continue;

    const at = profile.readUInt32BE(entry + 4);
    if (at + 28 > profile.length) return null;
    const type = profile.toString("latin1", at, at + 4);

    if (type === "desc") {
      const n = profile.readUInt32BE(at + 8);
      return (
        profile
          .toString("latin1", at + 12, at + 12 + n)
          .replace(/\0.*$/, "")
          .trim() || null
      );
    }

    if (type === "mluc") {
      const len = profile.readUInt32BE(at + 20);
      const strAt = profile.readUInt32BE(at + 24);
      if (at + strAt + len > profile.length) return null;
      const raw = Buffer.from(profile.subarray(at + strAt, at + strAt + len));
      raw.swap16();
      return raw.toString("utf16le").replace(/\0/g, "").trim() || null;
    }
  }

  return null;
};

const pngProfileName = (bytes: Buffer): string | null => {
  let offset = 8;
  let sawSrgbChunk = false;

  while (offset + 8 < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);

    if (type === "sRGB") sawSrgbChunk = true;
    if (type === "iCCP") {
      const body = bytes.subarray(offset + 8, offset + 8 + length);
      const nul = body.indexOf(0);
      const name = body.toString("latin1", 0, nul);
      try {
        return iccDescription(zlib.inflateSync(body.subarray(nul + 2))) || name;
      } catch {
        return name;
      }
    }
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }

  return sawSrgbChunk ? "sRGB" : null;
};

/** The embedded colour profile's name, or null when the file carries none. */
export const readColorProfile = (bytes: Buffer): string | null => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const profile = jpegIccProfile(bytes);
    return profile ? iccDescription(profile) : null;
  }
  if (bytes.toString("latin1", 1, 4) === "PNG") return pngProfileName(bytes);
  return null;
};

/** No profile counts as sRGB here: every decoder assumes it, and the photos
 * that actually work in production are the ones with no profile at all. */
export const isSrgb = (profileName: string | null) =>
  profileName === null || /s\s*rgb/i.test(profileName);

export type ConversionResult = {
  buffer: Buffer;
  contentType: string;
  /** False means the input was already fine and these are the original bytes. */
  converted: boolean;
  /** The profile that was replaced, for logging. Null when nothing changed. */
  replacedProfile: string | null;
};

// heic-convert is WASM and CPU-bound: a 12MP iPhone photo takes ~4s, all of it
// on whatever thread calls it. On the main thread that freezes every other
// request (health checks included) for the duration, so it runs in a worker.
// Inline source, so it needs no separate file in the tsc build; the module is
// passed by absolute path because an eval'd worker does not resolve relative
// to this file.
const HEIC_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
require(workerData.modulePath)({ buffer: workerData.buffer, format: "PNG" }).then((out) => {
  const bytes = new Uint8Array(out).slice();
  parentPort.postMessage(bytes, [bytes.buffer]);
});
`;

// Each decode holds tens of MB of pixels plus the WASM heap, so cap how many
// run at once. The slot is handed straight to the next waiter on release so
// the cap cannot be overshot by a caller arriving in between.
const MAX_CONCURRENT_HEIC_DECODES = 2;
let activeDecodes = 0;
const waitingDecodes: Array<() => void> = [];

const withDecodeSlot = async <T>(work: () => Promise<T>): Promise<T> => {
  if (activeDecodes < MAX_CONCURRENT_HEIC_DECODES) {
    activeDecodes += 1;
  } else {
    await new Promise<void>((resolve) => waitingDecodes.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = waitingDecodes.shift();
    if (next) next();
    else activeDecodes -= 1;
  }
};

const decodeHeicToPng = (buffer: Buffer): Promise<Buffer> =>
  withDecodeSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        const worker = new Worker(HEIC_WORKER_SOURCE, {
          eval: true,
          workerData: { modulePath: require.resolve("heic-convert"), buffer },
        });
        worker.once("message", (bytes: Uint8Array) =>
          resolve(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)),
        );
        worker.once("error", reject);
        worker.once("exit", (code) => reject(new Error(`HEIC worker exited with ${code}`)));
      }),
  );

/** Insert an iCCP chunk straight after IHDR, so the profile travels with the
 * pixels. sharp cannot take a raw ICC buffer as an input profile, and its
 * built-in "p3" is not a substitute: measured against macOS ColorSync it left
 * the pixels essentially unconverted, where the photo's own profile converts
 * correctly. */
const embedPngProfile = (png: Buffer, icc: Buffer): Buffer => {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature + IHDR (length, type, data, crc)
  const body = Buffer.concat([Buffer.from("icc\0\0", "latin1"), zlib.deflateSync(icc)]);
  const typeAndBody = Buffer.concat([Buffer.from("iCCP", "latin1"), body]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndBody));
  return Buffer.concat([
    png.subarray(0, ihdrEnd),
    length,
    typeAndBody,
    crc,
    png.subarray(ihdrEnd),
  ]);
};

/**
 * Decode HEIC to a lossless PNG, keeping the colour profile.
 *
 * sharp's prebuilt libvips has no HEVC decoder (`format.heif` is AVIF-only), so
 * the pixels come from heic-convert's WASM libheif instead. That drops the
 * container's ICC profile, and an iPhone HEIC is nearly always Display P3 -- so
 * the profile is read back with sharp (which can parse the container) and
 * re-attached, which lets the shared path below convert to sRGB properly
 * instead of leaving P3 values that every decoder would read as sRGB.
 *
 * PNG rather than JPEG so the photo is only lossy-encoded once, at the end.
 * libheif applies the container's rotation/mirror itself, so orientation is
 * already baked into the pixels.
 */
const decodeHeic = async (buffer: Buffer, filename: string): Promise<Buffer> => {
  try {
    const { icc } = await sharp(buffer).metadata();
    const png = await decodeHeicToPng(buffer);
    return icc ? embedPngProfile(png, icc) : png;
  } catch {
    throw new UnsupportedImageError(
      filename,
      "image/heic",
      `"${filename}" looks damaged or is a HEIC variant we can't read. Please ` +
        "re-export it as a JPEG and try again.",
    );
  }
};

/**
 * Normalise an image to something GPT-Image-2.5 will accept.
 *
 * Decides from the bytes, never from a declared MIME type. Returns the input
 * untouched when it is already acceptable -- re-encoding a clean JPEG would
 * cost quality for nothing.
 *
 * HEIC is decoded and always comes back as an sRGB JPEG. Throws
 * UnsupportedImageError for anything that is not an image we can handle.
 */
export const convertToSrgbJpeg = async (
  buffer: Buffer,
  filename: string,
): Promise<ConversionResult> => {
  const format = sniffFormat(buffer);
  const isHeic = format === "image/heic";

  if (!isHeic && !ACCEPTED_FORMATS.has(format)) {
    throw new UnsupportedImageError(
      filename,
      format,
      `"${filename}" isn't a JPEG, PNG, WebP or HEIC image. Please upload one of those.`,
    );
  }

  const input = isHeic ? await decodeHeic(buffer, filename) : buffer;

  const profile = readColorProfile(input);
  if (!isHeic && isSrgb(profile)) {
    return { buffer, contentType: format, converted: false, replacedProfile: null };
  }

  const converted = await sharp(input)
    .rotate()
    .toColorspace("srgb")
    .withMetadata({ icc: "srgb" })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  return {
    buffer: converted,
    contentType: "image/jpeg",
    converted: true,
    replacedProfile: profile,
  };
};
