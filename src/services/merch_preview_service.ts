/**
 * Shop previews — a small copy of exactly what would print, for every product and
 * treatment, so the showroom can put the customer's own image on each product.
 *
 * Previews come from the same plan as the print file (`planPrintFile`), so the crop
 * and cutout a customer sees are the crop and cutout that print. No AI touches the
 * image here: crop + Lanczos only, so the pet cannot be re-stylized.
 *
 * Storage is S3 only, no database:
 *   merch/previews/{srcSha}/{version}/{productKey}-{treatment}.{jpg|png}   immutable, served via CloudFront
 *   merch/previews/{srcSha}/{version}/manifest.json                        mutable, read from S3 directly
 * The manifest is never served through CloudFront — it changes from pending to ready
 * and a cached copy would stall the shop.
 *
 * Spec: specs/merch-m4-shop-showroom-architecture.md
 */
import crypto from "node:crypto";

import {
  artAspect,
  needsSubjectAwareCrop,
  PRINT_PRODUCTS,
  SOURCE_ASPECT,
  Treatment,
} from "@/constants/print_products";

import { getObjectFromS3, uploadFileToS3 } from "./aws_service";
import { addErrorLog } from "./error_logs_service";
import { mockupCalibrationFor, renderMockup } from "./merch_mockup_service";
import { watermark } from "./watermark_service";
import {
  personalizationFor,
  planPrintFile,
  PrintOptions,
  renderPreview,
} from "./print_file_service";

/** Bump when print geometry or the preview render changes. Old previews are orphaned, not overwritten. */
export const PREVIEW_VERSION = "v2"; // v2 2026-09-28: cooler + pillow safe-area layout

/** Products the shop sells. The pint glass exists in the print catalog but is not for sale. */
export const SHOP_PRODUCT_KEYS = [
  "poster_8x10",
  "framed_8x10",
  "canvas_16x20",
  "mug_11oz",
  "coaster_4x4",
  "can_cooler",
  "pillow_18x18",
  "ornament_ceramic_circle",
  "ornament_metal_oval",
  "card_4x6",
  "pet_bowl",
] as const;
const TREATMENTS: Treatment[] = ["panel", "cutout"];
const PREVIEW_MAX_EDGE = 800;
/** Bump when the band (name) layout changes, so name-bearing previews re-render. */
const BAND_LAYOUT_VERSION = "b2";

/** Band products (pet bowl) only have the full-scene design. */
const treatmentsFor = (productKey: string): Treatment[] =>
  PRINT_PRODUCTS[productKey]?.band ? ["panel"] : TREATMENTS;

/** What a band preview depends on beyond the image: the printed name (or why none prints). */
const personalizationEntry = (
  productKey: string,
  displayName: string | null | undefined,
) => {
  const pz = personalizationFor(productKey, displayName);
  if (!pz) {
    return undefined;
  }
  const nameKey = crypto
    .createHash("sha256")
    .update(
      `${BAND_LAYOUT_VERSION}|${JSON.stringify(pz.lines ? [...pz.lines, pz.frontPortrait] : ["∅", pz.omitted])}`,
    )
    .digest("hex")
    .slice(0, 12);
  return { nameKey, lines: pz.lines, frontPortrait: pz.frontPortrait, omitted: pz.omitted };
};

export type PreviewEntry = {
  productKey: string;
  treatment: Treatment;
  status: "ready" | "pending" | "failed";
  url?: string;
  width?: number;
  height?: number;
  /** Share of the artwork trimmed away to fit the product's shape, 0-1. The shop must say so. */
  trimmed: number;
  error?: string;
  /** Photoreal version on Printful's product photo, once this product has a passing calibration. */
  mockup?: { url: string; width: number; height: number; calibration: string };
  /** Calibration id a mockup render failed for, so a broken render isn't retried on every poll. */
  mockupFailed?: string;
  /** Band products: the name this preview prints (lines), or why none prints. Keyed so a changed name re-renders. */
  personalization?: {
    nameKey: string;
    lines: string[] | null;
    /** false: the name was too long beside the portrait, so it prints alone on the front. */
    frontPortrait?: boolean;
    omitted?: string;
  };
};

export type PreviewManifest = {
  srcSha: string;
  version: string;
  entries: PreviewEntry[];
  updatedAt: string;
  /** False while anything the shop will show is still being made; the shop polls until true. */
  complete?: boolean;
};

const sha = (b: Buffer) =>
  crypto.createHash("sha256").update(b).digest("hex").slice(0, 32);
const base = (srcSha: string) => `merch/previews/${srcSha}/${PREVIEW_VERSION}`;
const manifestKey = (srcSha: string) => `${base(srcSha)}/manifest.json`;

/** An entry can render without rembg only when it is a full scene AND the crop is mild. */
const needsRembg = (productKey: string, treatment: Treatment) =>
  treatment === "cutout" || needsSubjectAwareCrop(PRINT_PRODUCTS[productKey]);

const trimmedShare = (productKey: string) => {
  const target = artAspect(PRINT_PRODUCTS[productKey]);
  const lost =
    target > SOURCE_ASPECT
      ? 1 - SOURCE_ASPECT / target
      : 1 - target / SOURCE_ASPECT;
  return Math.round(lost * 100) / 100;
};

const readManifest = async (
  srcSha: string,
): Promise<PreviewManifest | null> => {
  const raw = await getObjectFromS3(manifestKey(srcSha));
  return raw ? (JSON.parse(raw.toString("utf8")) as PreviewManifest) : null;
};

const writeManifest = async (m: PreviewManifest) => {
  m.updatedAt = new Date().toISOString();
  await uploadFileToS3({
    Key: manifestKey(m.srcSha),
    buffer: Buffer.from(JSON.stringify(m)),
    fileType: "application/json",
  });
};

/** Preview inputs: the print options plus whether the customer's copy is watermarked. */
export type PreviewOptions = PrintOptions & { watermark?: boolean };

const nameSuffix = (e: PreviewEntry) =>
  e.personalization ? `-n${e.personalization.nameKey}` : "";

const renderEntry = async (
  source: Buffer,
  srcSha: string,
  e: PreviewEntry,
  opts: PreviewOptions,
): Promise<PreviewEntry> => {
  try {
    const plan = await planPrintFile(source, e.productKey, e.treatment, opts);
    // Band previews are wide (8:1); 800 px would blur the name, so they get their own width.
    const p = await renderPreview(
      plan,
      PRINT_PRODUCTS[e.productKey]?.band?.previewWidth ?? PREVIEW_MAX_EDGE,
    );
    // The product prints clean; only the customer's preview (and so its mockup) is watermarked.
    const buffer = opts.watermark ? await watermark(p.buffer) : p.buffer;
    const url = await uploadFileToS3({
      Key: `${base(srcSha)}/${e.productKey}-${e.treatment}${nameSuffix(e)}.${p.format === "png" ? "png" : "jpg"}`,
      buffer,
      fileType: p.format === "png" ? "image/png" : "image/jpeg",
    });
    if (!url) {
      throw new Error("S3 upload failed");
    }
    return {
      ...e,
      status: "ready",
      url,
      width: p.width,
      height: p.height,
      error: undefined,
    };
  } catch (err) {
    return { ...e, status: "failed", error: (err as Error).message };
  }
};

/** Full-scene previews of calibrated products get a photoreal mockup (cut-out isn't offered). */
const needsMockup = (e: PreviewEntry) => {
  const cal =
    e.treatment === "panel" && e.status === "ready"
      ? mockupCalibrationFor(e.productKey)
      : null;
  return (
    Boolean(cal) &&
    e.mockup?.calibration !== cal!.id &&
    e.mockupFailed !== cal!.id
  );
};

const renderMockupEntry = async (
  srcSha: string,
  e: PreviewEntry,
): Promise<PreviewEntry> => {
  const cal = mockupCalibrationFor(e.productKey)!;
  try {
    // Place the exact preview the shop already shows, so mockup and "exact print" can't disagree.
    const res = await fetch(e.url!);
    if (!res.ok) {
      throw new Error(`preview fetch failed ${res.status}`);
    }
    const m = await renderMockup(cal, Buffer.from(await res.arrayBuffer()));
    const url = await uploadFileToS3({
      Key: `${base(srcSha)}/${e.productKey}-${e.treatment}${nameSuffix(e)}-mockup-${cal.id}.webp`,
      buffer: m.buffer,
      fileType: "image/webp",
    });
    if (!url) {
      throw new Error("S3 upload failed");
    }
    return {
      ...e,
      mockup: { url, width: m.width, height: m.height, calibration: cal.id },
      mockupFailed: undefined,
    };
  } catch (err) {
    // The flat preview still shows; a mockup failure must never take the product away.
    console.error(
      "[merch-previews] mockup failed",
      srcSha,
      e.productKey,
      (err as Error).message,
    );
    return { ...e, mockupFailed: cal.id };
  }
};

const isComplete = (m: PreviewManifest) =>
  !m.entries.some((e) => e.status === "pending" || needsMockup(e));

/** One background job per source per process. Another instance may duplicate it; rembg is cached in S3, so that costs little. */
const running = new Map<string, Promise<void>>();

const finishInBackground = (
  source: Buffer,
  manifest: PreviewManifest,
  opts: PreviewOptions,
) => {
  if (running.has(manifest.srcSha)) {
    return;
  }
  const job = (async () => {
    for (const [i, e] of manifest.entries.entries()) {
      if (e.status === "ready") {
        continue;
      }
      manifest.entries[i] = await renderEntry(source, manifest.srcSha, e, opts);
      manifest.complete = isComplete(manifest);
      await writeManifest(manifest);
    }
    for (const [i, e] of manifest.entries.entries()) {
      if (!needsMockup(e)) {
        continue;
      }
      manifest.entries[i] = await renderMockupEntry(manifest.srcSha, e);
      manifest.complete = isComplete(manifest);
      await writeManifest(manifest);
    }
    const failed = manifest.entries.filter((e) => e.status === "failed");
    if (failed.length) {
      addErrorLog({
        error: failed
          .map((e) => `${e.productKey}/${e.treatment}: ${e.error}`)
          .join("; "),
        input: JSON.stringify({ srcSha: manifest.srcSha }),
        type: "MERCH_PREVIEW_FAILED",
      });
    }
  })()
    .catch((err) =>
      console.error(
        "[merch-previews] background job crashed",
        manifest.srcSha,
        err,
      ),
    )
    .finally(() => running.delete(manifest.srcSha));
  running.set(manifest.srcSha, job);
};

/**
 * Make sure previews exist for this image and return what's ready now. Idempotent:
 * call it as often as you like (the shop polls it). Fast entries render before it
 * returns; anything needing background removal comes back "pending" and fills in.
 * A job that died, here or on another instance, is restarted by the next call.
 */
export const ensurePreviews = async (
  source: Buffer,
  opts: PreviewOptions = {},
): Promise<PreviewManifest> => {
  // Watermarked previews (free-credit images) are a separate set, so unlocking an image switches
  // the shop to clean previews instead of serving cached watermarked ones.
  const srcSha = sha(source) + (opts.watermark ? "-wm" : "");
  let manifest = await readManifest(srcSha);
  const newEntry = (
    productKey: string,
    treatment: Treatment,
  ): PreviewEntry => ({
    productKey,
    treatment,
    status: "pending",
    trimmed: trimmedShare(productKey),
    personalization: personalizationEntry(productKey, opts.displayName),
  });
  if (manifest) {
    // A band preview (pet bowl) whose printed name no longer matches is re-rendered in place.
    manifest.entries = manifest.entries.map((e) => {
      const pz = personalizationEntry(e.productKey, opts.displayName);
      return pz && e.personalization?.nameKey !== pz.nameKey
        ? newEntry(e.productKey, e.treatment)
        : e;
    });
    // Products added to the shop after this image's manifest was made get their entries now
    // (rendered by the background job below), so existing customers see new products too.
    const have = new Set(
      manifest.entries.map((e) => `${e.productKey}/${e.treatment}`),
    );
    for (const productKey of SHOP_PRODUCT_KEYS) {
      for (const treatment of treatmentsFor(productKey)) {
        if (!have.has(`${productKey}/${treatment}`)) {
          manifest.entries.push(newEntry(productKey, treatment));
        }
      }
    }
  }

  if (!manifest) {
    manifest = {
      srcSha,
      version: PREVIEW_VERSION,
      updatedAt: "",
      entries: SHOP_PRODUCT_KEYS.flatMap((productKey) =>
        treatmentsFor(productKey).map((treatment) =>
          newEntry(productKey, treatment),
        ),
      ),
    };
    // Full-scene previews with a mild crop need no rembg: render them now (ms each).
    const m = manifest;
    await Promise.all(
      m.entries.map(async (e, i) => {
        if (!needsRembg(e.productKey, e.treatment)) {
          m.entries[i] = await renderEntry(source, srcSha, e, opts);
        }
      }),
    );
    await writeManifest(manifest);
  }

  if (manifest.entries.some((e) => e.status !== "ready" || needsMockup(e))) {
    // Failed entries get retried too — a transient rembg failure shouldn't be permanent.
    // Manifests made before a product was calibrated pick up their mockups here.
    finishInBackground(source, manifest, opts);
  }
  return { ...manifest, complete: isComplete(manifest) };
};

export const previewsEnabled = () =>
  process.env.MERCH_PREVIEWS_ENABLED === "true";
