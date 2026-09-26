/**
 * Print-file service — turns a finished generation into a file a POD provider
 * will accept without a human touching it.
 *
 * UPSCALING IS SETTLED. Use Lanczos, never an AI upscaler.
 * M0 measured aura-sr, esrgan and clarity against plain Lanczos across all five
 * regression pets. Lanczos won on fidelity every time, with zero colour drift
 * (0.0 vs 4.3-13.0). All three tiers (2x/3x/4x) are confirmed on PHYSICAL PRINTS,
 * including Wizard — a solid black cat — at 3.91x on a 16x20.
 *
 * The output looks soft on a monitor. It printed fine. Do not "improve" this by
 * adding an upscaler because of how it looks on screen.
 * Evidence: specs/merch-m0-report.md
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { fal } from "@fal-ai/client";

import {
  PRINT_PRODUCTS, PrintProduct, Treatment,
  needsSubjectAwareCrop, outputSize, productAspect,
} from "@/constants/print_products";
import { getObjectFromS3, uploadFileToS3 } from "./aws_service";
import { handleRemoveBackground } from "./fal_service";

const CACHE_DIR = path.join(process.cwd(), "Claude outputs", ".print-cache");
/**
 * Shared rembg cache. Local disk alone is per-instance and wiped on every EB deploy,
 * so the shop preview and the eventual print could be cut from different masks.
 * S3 makes the first mask the only mask. Bump the version if the rembg model changes.
 */
const derivedKey = (hash: string) => `merch/derived/${hash}/rembg-v1.png`;

export type PrintFileResult = {
  buffer: Buffer;
  product: PrintProduct;
  treatment: Treatment;
  width: number;
  height: number;
  dpi: number;
  format: "png" | "jpeg";
  usedSubjectCrop: boolean;
  subjectBbox: { left: number; top: number; width: number; height: number } | null;
  notes: string[];
};

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 32);

/**
 * rembg, cached by image hash. The cache is what makes cutout output deterministic —
 * a network call is not. It also means a customer ordering three square products
 * pays for one mask. Local disk first (fast), then S3 (shared across instances and
 * deploys), then a fresh call that fills both.
 */
const cutoutCached = async (input: Buffer, notes: string[]): Promise<Buffer> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const hash = sha(input);
  const cached = path.join(CACHE_DIR, `${hash}-rembg.png`);
  if (fs.existsSync(cached)) {
    notes.push("rembg: cache hit");
    return fs.readFileSync(cached);
  }
  try {
    const shared = await getObjectFromS3(derivedKey(hash));
    if (shared) {
      fs.writeFileSync(cached, shared);
      notes.push("rembg: S3 cache hit");
      return shared;
    }
  } catch (e) {
    // A read failure must not block an order; the worst case is one extra rembg call.
    notes.push(`rembg: S3 cache read failed (${(e as Error).name}), calling fresh`);
  }
  const blob = new Blob([new Uint8Array(input)], { type: "image/png" });
  const url = await fal.storage.upload(blob as unknown as File);
  const outUrl = await handleRemoveBackground(url);
  const res = await fetch(outUrl);
  if (!res.ok) throw new Error(`rembg download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(cached, buf);
  const stored = await uploadFileToS3({ Key: derivedKey(hash), buffer: buf, fileType: "image/png" });
  notes.push(stored ? "rembg: fresh call, cached locally and in S3" : "rembg: fresh call, cached locally (S3 write failed)");
  return buf;
};

/**
 * rembg leaves soft semi-transparent fringe carrying background colour. Invisible
 * on a dark garment, grey fringing on a light one. Push low and mid alpha toward
 * zero while leaving opaque pixels untouched, so fur wisps survive but the fringe
 * stops carrying the old background.
 */
const deHalo = async (png: Buffer): Promise<Buffer> => {
  const { data, info } = await sharp(png).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a > 0 && a < 255) {
      data[i] = Math.max(0, Math.min(255, Math.round(a * 1.4 - 60)));
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toBuffer();
};

/** Tight bounding box of non-transparent pixels. */
const alphaBbox = async (png: Buffer) => {
  const { data, info } = await sharp(png).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

/** Crop window for a target aspect, centred on the subject when one is known. */
const cropWindow = (
  srcW: number, srcH: number, targetAspect: number,
  subject: { left: number; top: number; width: number; height: number } | null,
) => {
  let w = srcW, h = srcH;
  if (srcW / srcH > targetAspect) w = Math.round(srcH * targetAspect);
  else h = Math.round(srcW / targetAspect);

  const cx = subject ? subject.left + subject.width / 2 : srcW / 2;
  const cy = subject ? subject.top + subject.height / 2 : srcH / 2;
  const left = Math.max(0, Math.min(srcW - w, Math.round(cx - w / 2)));
  const top = Math.max(0, Math.min(srcH - h, Math.round(cy - h / 2)));
  return { left, top, width: w, height: h };
};

/**
 * Everything that decides WHICH pixels print: treatment, subject box, crop window.
 * The print file and the shop preview both render from one plan, so a preview can
 * never show a different crop or cutout than the order will print.
 */
export type PrintPlan = {
  product: PrintProduct;
  treatment: Treatment;
  /** Source after treatment (cutout applied), before any crop. */
  working: Buffer;
  win: { left: number; top: number; width: number; height: number };
  size: ReturnType<typeof outputSize>;
  subjectBbox: PrintFileResult["subjectBbox"];
  notes: string[];
};

export const planPrintFile = async (
  input: Buffer,
  productKey: string,
  treatment: Treatment = "panel",
): Promise<PrintPlan> => {
  const product = PRINT_PRODUCTS[productKey];
  if (!product) {
    throw new Error(
      `Unknown product "${productKey}". Known: ${Object.keys(PRINT_PRODUCTS).join(", ")}`,
    );
  }

  const notes: string[] = [];
  const size = outputSize(product);
  const wantsSubject = needsSubjectAwareCrop(product);

  // 1. Treatment.
  let working = input;
  if (treatment === "cutout") {
    working = await deHalo(await cutoutCached(input, notes));
    notes.push("halo reduction applied to alpha");
  }

  // 2. Subject box, only when the crop is aggressive enough to matter.
  let subjectBbox: PrintFileResult["subjectBbox"] = null;
  if (wantsSubject) {
    try {
      const masked = treatment === "cutout" ? working : await cutoutCached(input, notes);
      subjectBbox = await alphaBbox(masked);
      notes.push(subjectBbox ? "crop aimed at subject" : "subject mask empty, centring");
    } catch (e) {
      notes.push(`rembg failed, falling back to centre-crop: ${(e as Error).message}`);
    }
  }

  // 3. Crop to aspect BEFORE resizing — resizing first wastes pixels and softens.
  const meta = await sharp(working).metadata();
  const srcW = meta.width ?? 0, srcH = meta.height ?? 0;
  const win = cropWindow(srcW, srcH, productAspect(product), subjectBbox);

  return { product, treatment, working, win, size, subjectBbox, notes };
};

/** Crop to the plan's window, then one Lanczos pass to the requested size. */
const renderAt = (plan: PrintPlan, width: number, height: number) =>
  sharp(plan.working)
    .extract(plan.win)
    .resize(width, height, { kernel: "lanczos3", fit: "fill" });

export const buildPrintFile = async (
  input: Buffer,
  productKey: string,
  treatment: Treatment = "panel",
): Promise<PrintFileResult> => {
  const plan = await planPrintFile(input, productKey, treatment);
  const { product, size, subjectBbox, notes } = plan;

  // 4. One Lanczos pass to final visible size.
  let pipeline = renderAt(plan, size.visibleW, size.visibleH);

  // 5. Mirrored bleed for gallery wrap, so the wrap never shows a raw edge.
  if (size.bleedPx > 0) {
    pipeline = sharp(await pipeline.png().toBuffer()).extend({
      top: size.bleedPx, bottom: size.bleedPx,
      left: size.bleedPx, right: size.bleedPx,
      extendWith: "mirror",
    });
    notes.push(`${product.bleedIn}in mirrored bleed (${size.bleedPx}px) on all sides`);
  }

  // 6. Encode. Transparency needs PNG; everything else gets high-quality JPEG.
  const format: "png" | "jpeg" = treatment === "cutout" ? "png" : "jpeg";
  const withDensity = pipeline.withMetadata({ density: product.dpi });
  const buffer = format === "png"
    ? await withDensity.png({ compressionLevel: 9 }).toBuffer()
    : await withDensity.jpeg({ quality: 97, chromaSubsampling: "4:4:4" }).toBuffer();

  const out = await sharp(buffer).metadata();
  return {
    buffer, product, treatment,
    width: out.width ?? size.fullW,
    height: out.height ?? size.fullH,
    dpi: product.dpi,
    format,
    usedSubjectCrop: Boolean(subjectBbox),
    subjectBbox,
    notes,
  };
};

/**
 * Small copy of exactly what prints, for the shop's product mockups. Same plan, same
 * crop, same cutout as the print file; only the size differs. Visible area only — the
 * canvas wrap bleed is not part of what the customer sees on the front.
 */
export const renderPreview = async (plan: PrintPlan, maxEdge = 800) => {
  const { visibleW, visibleH } = plan.size;
  const scale = Math.min(1, maxEdge / Math.max(visibleW, visibleH));
  const width = Math.round(visibleW * scale), height = Math.round(visibleH * scale);
  const format: "png" | "jpeg" = plan.treatment === "cutout" ? "png" : "jpeg";
  const pipeline = renderAt(plan, width, height);
  const buffer = format === "png"
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
    : await pipeline.jpeg({ quality: 88 }).toBuffer();
  return { buffer, width, height, format };
};
