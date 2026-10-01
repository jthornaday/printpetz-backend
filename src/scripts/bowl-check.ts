/**
 * Pet bowl print-file check: awkward names x the regression pets. No network, no Printful.
 *
 *   npm run build && npm run bowl-check [-- --pets=<folder with <Pet>/original.jpg>]
 *
 * For every name, the layout is checked on a flat grey stand-in image (so any navy is lettering):
 *   - lettering is printed exactly when a name prints, and the outcome is the expected one
 *   - when a name prints, the front lockup is centred on W/2 and at most lockup.maxWidthPx wide.
 *     The layout centres by advance width (typographic), so the ink sits off by half the
 *     outer side bearings: up to ~10 px (ZOË, 0.03 in). Tolerance is 12 px.
 * For every pet x name, the real print file is checked:
 *   - 6496x803, 300 DPI, JPEG; nothing but white within seamClearancePx of either end
 *   - the shop preview matches the print file (both downscaled to 650 px wide, so resampling
 *     noise in the photos doesn't count but a moved or missing element does)
 * Exits 1 if anything fails. Spec: specs/merch-pet-bowl.md ("Test plan").
 */
import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { PRINT_PRODUCTS } from "@/constants/print_products";
import {
  buildPrintFile,
  personalizationFor,
  planPrintFile,
  renderPreview,
} from "@/services/print_file_service";

const KEY = "pet_bowl";
const PETS = ["Wizard", "Moses", "George", "Max", "Darla"];

/** Expected outcome: "photo" (name beside the portrait), "alone" (name only), or why none prints. */
type Expect =
  | "photo"
  | "alone"
  | "no_name"
  | "unsupported_characters"
  | "too_long"
  | "any";
const NAMES: Array<[string | null, Expect, string?]> = [
  ["Max", "photo", "MAX"],
  ["Darla", "photo", "DARLA"],
  ["Wizard", "photo", "WIZARD"],
  ["George", "photo", "GEORGE"],
  ["Moses", "photo", "MOSES"],
  ["Mr Beans", "photo", "MR BEANS"],
  ["Snickers", "alone", "SNICKERS"],
  ["Sir Barkington", "alone", "SIR BARKINGTON"],
  ["Princess Buttercup", "alone", "PRINCESS BUTTERCUP"],
  ["Captain Fluffypants", "alone", "CAPTAIN FLUFFYPANTS"],
  ["Mr. Whiskers McFluff", "too_long"],
  ["Barkingtonshire", "too_long"],
  ["Max 🐶", "photo", "MAX"],
  ["  max  ", "photo", "MAX"],
  ["Мишка", "unsupported_characters"],
  ["小白", "unsupported_characters"],
  ["🐶", "no_name"],
  [null, "no_name"],
  ["   ", "no_name"],
  ["A".repeat(60), "too_long"],
  ["Zoë", "any"],
  ["José", "any"],
  ["O'Malley", "any"],
  ["O’Malley", "any"],
  ["<b>&amp;</b>", "any"],
];

const product = PRINT_PRODUCTS[KEY];
const W = Math.round(product.widthIn * product.dpi),
  H = Math.round(product.heightIn * product.dpi);
const band = product.band!;

const raw = async (buf: Buffer) =>
  sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });

/** Columns [x0, x1) where any pixel is darker than `below` in any channel. */
const inkColumns = (
  d: Buffer,
  w: number,
  h: number,
  x0: number,
  x1: number,
  below: number,
) => {
  const cols: number[] = [];
  for (let x = x0; x < x1; x++) {
    for (let y = 0; y < h; y++) {
      const o = (y * w + x) * 3;
      if (d[o] < below || d[o + 1] < below || d[o + 2] < below) {
        cols.push(x);
        break;
      }
    }
  }
  return cols;
};

const navyPixels = (d: Buffer) => {
  const [r, g, b] = [0x14, 0x26, 0x4f];
  let n = 0;
  for (let o = 0; o < d.length; o += 3) {
    if (
      Math.abs(d[o] - r) < 40 &&
      Math.abs(d[o + 1] - g) < 40 &&
      Math.abs(d[o + 2] - b) < 40
    ) {
      n++;
    }
  }
  return n;
};

const main = async () => {
  const petsDir =
    process.argv.find((a) => a.startsWith("--pets="))?.slice(7) ??
    "Claude outputs/upscale-eval";
  const failures: string[] = [];
  const fail = (what: string) => {
    failures.push(what);
    console.log(`  FAIL ${what}`);
  };

  // 1. Layout per name, on a flat grey stand-in (4:5, like a real generation).
  const grey = await sharp({
    create: { width: 1024, height: 1280, channels: 3, background: "#808080" },
  })
    .png()
    .toBuffer();
  console.log("name layout");
  for (const [name, expect, printed] of NAMES) {
    const label = JSON.stringify(name).slice(0, 24);
    const pz = personalizationFor(KEY, name)!;
    const outcome = pz.lines
      ? pz.frontPortrait
        ? "photo"
        : "alone"
      : pz.omitted;
    const r = await buildPrintFile(grey, KEY, "panel", { displayName: name });
    const { data } = await raw(r.buffer);
    const navy = navyPixels(data);
    const lockup = inkColumns(data, W, H, W / 2 - 1300, W / 2 + 1300, 240);
    const lockW = lockup.length ? lockup[lockup.length - 1] - lockup[0] + 1 : 0;
    const off = lockup.length
      ? (lockup[0] + lockup[lockup.length - 1] + 1) / 2 - W / 2
      : 0;
    console.log(
      `  ${label.padEnd(26)} ${String(outcome).padEnd(22)} ${String(r.printedName ?? "-").padEnd(22)} lockup ${lockW}px off ${off.toFixed(1)} navy ${navy}`,
    );
    if (expect !== "any" && outcome !== expect) {
      fail(`${label}: expected ${expect}, got ${outcome}`);
    }
    if (printed && r.printedName !== printed) {
      fail(`${label}: printed ${r.printedName}, expected ${printed}`);
    }
    if (Boolean(r.printedName) !== navy > 200) {
      fail(`${label}: printedName ${r.printedName} but ${navy} navy pixels`);
    }
    if (r.printedName && r.printedName !== pz.lines?.join(" ")) {
      fail(
        `${label}: printedName ${r.printedName} differs from plan ${pz.lines?.join(" ")}`,
      );
    }
    if (r.printedName && Math.abs(off) > 12) {
      fail(`${label}: lockup off-centre by ${off.toFixed(1)} px`);
    }
    if (r.printedName && lockW > band.lockup.maxWidthPx) {
      fail(`${label}: lockup ${lockW} px wider than ${band.lockup.maxWidthPx}`);
    }
    if (!r.printedName && Math.abs(off) > 2) {
      fail(
        `${label}: portraits-only layout off-centre by ${off.toFixed(1)} px`,
      );
    }
  }

  // 2. Real pets: file format, seam, and preview == print.
  console.log("pets x names");
  for (const pet of PETS) {
    const src = fs.readFileSync(path.join(petsDir, pet, "original.jpg"));
    for (const [name] of NAMES) {
      const label = `${pet} ${JSON.stringify(name).slice(0, 20)}`;
      const r = await buildPrintFile(src, KEY, "panel", { displayName: name });
      const meta = await sharp(r.buffer).metadata();
      if (
        meta.width !== W ||
        meta.height !== H ||
        meta.density !== 300 ||
        meta.format !== "jpeg"
      ) {
        fail(
          `${label}: ${meta.width}x${meta.height} ${meta.density}dpi ${meta.format}`,
        );
      }
      const { data } = await raw(r.buffer);
      const seam = [
        ...inkColumns(data, W, H, 0, band.seamClearancePx, 245),
        ...inkColumns(data, W, H, W - band.seamClearancePx, W, 245),
      ];
      if (seam.length) {
        fail(
          `${label}: ink within ${band.seamClearancePx} px of the seam (columns ${seam[0]}..${seam[seam.length - 1]})`,
        );
      }
      const prev = await renderPreview(
        await planPrintFile(src, KEY, "panel", { displayName: name }),
        band.previewWidth,
      );
      const small = (buf: Buffer) =>
        sharp(buf)
          .resize(650, 80, { fit: "fill" })
          .removeAlpha()
          .raw()
          .toBuffer();
      const a = await small(prev.buffer);
      const b = await small(r.buffer);
      let sum = 0;
      for (let i = 0; i < a.length; i++) {
        sum += Math.abs(a[i] - b[i]);
      }
      const mad = sum / a.length;
      if (mad > 3) {
        fail(
          `${label}: preview differs from print (mean abs diff ${mad.toFixed(2)})`,
        );
      }
    }
    console.log(`  ${pet}: ${NAMES.length} names checked`);
  }

  console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
