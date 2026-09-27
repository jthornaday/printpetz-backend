/**
 * Photoreal shop mockups: the customer's flat preview placed onto Printful's own
 * product photo, with Printful's lighting, curvature and print area.
 *
 * Each product has a one-time calibration (src/constants/merch_calibrations.json,
 * made by `npm run merch-calibrate`):
 *   photo  - Printful's render of a plain white print file: a blank product photo
 *            with real lighting (PNG with transparent background)
 *   alpha  - where print lands on that photo (0-255), from white vs black renders
 *   cu, cv - a smooth map from photo pixel (x, y) to preview coords (u, v), fitted
 *            to a dot grid Printful rendered at known positions
 * Only products whose calibration passed the 5-pet check against Printful's own
 * mockups of the real print file are in the registry.
 *
 * No AI touches the image: bilinear sampling of the preview, multiplied by the
 * photo's lighting. Transparent art shows the product surface, never the page.
 *
 * Spec: specs/merch-m4-shop-showroom-architecture.md ("Decision 1 revisited").
 */
import sharp from "sharp";

import calibrations from "@/constants/merch_calibrations.json";

export type MockupCalibration = {
  /** Changes whenever the photo, mask or map changes; part of every mockup's S3 key. */
  id: string;
  styleId: number;
  width: number;
  height: number;
  /** Print-area bounding box on the photo: [x0, y0, x1, y1]. */
  bbox: [number, number, number, number];
  /** Normalisation for the polynomial: x' = (x - cx) / sx, y' = (y - cy) / sy. */
  norm: [number, number, number, number];
  cu: number[];
  cv: number[];
  photoUrl: string;
  alphaUrl: string;
};

const REGISTRY = calibrations as unknown as Record<string, MockupCalibration>;

export const mockupCalibrationFor = (
  productKey: string,
): MockupCalibration | null => REGISTRY[productKey] ?? null;

/** Same basis the calibration script fits: x^a * y^b for a, b <= 5 and a + b <= 6. */
export const mapBasis = (x: number, y: number) => {
  const t: number[] = [];
  for (let a = 0; a <= 5; a++) {
    for (let b = 0; b <= 5; b++) {
      if (a + b <= 6) {
        t.push(x ** a * y ** b);
      }
    }
  }
  return t;
};

type Prepared = {
  cal: MockupCalibration;
  photo: Buffer; // RGBA, width x height
  alpha: Float32Array; // 0-1 per photo pixel
  /** u, v per print-area pixel (row-major over bbox), precomputed once. */
  uv: Float32Array;
};

const prepared = new Map<string, Promise<Prepared>>();

const fetchBuffer = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`mockup asset fetch failed ${res.status} for ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
};

const prepare = (cal: MockupCalibration): Promise<Prepared> => {
  let p = prepared.get(cal.id);
  if (!p) {
    p = (async () => {
      const [photoRaw, alphaRaw] = await Promise.all([
        fetchBuffer(cal.photoUrl),
        fetchBuffer(cal.alphaUrl),
      ]);
      const photo = await sharp(photoRaw).ensureAlpha().raw().toBuffer();
      const a8 = await sharp(alphaRaw).extractChannel(0).raw().toBuffer();
      const alpha = new Float32Array(cal.width * cal.height);
      for (let i = 0; i < alpha.length; i++) {
        alpha[i] = a8[i] / 255;
      }
      const [x0, y0, x1, y1] = cal.bbox,
        [cx, cy, sx, sy] = cal.norm,
        bw = x1 - x0 + 1;
      const uv = new Float32Array(bw * (y1 - y0 + 1) * 2);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (alpha[y * cal.width + x] <= 0) {
            continue;
          }
          const t = mapBasis((x + 0.5 - cx) / sx, (y + 0.5 - cy) / sy);
          let u = 0,
            v = 0;
          for (let k = 0; k < t.length; k++) {
            u += t[k] * cal.cu[k];
            v += t[k] * cal.cv[k];
          }
          const o = ((y - y0) * bw + (x - x0)) * 2;
          uv[o] = u;
          uv[o + 1] = v;
        }
      }
      return { cal, photo, alpha, uv };
    })();
    p.catch(() => prepared.delete(cal.id)); // let a failed download retry next time
    prepared.set(cal.id, p);
  }
  return p;
};

/** Canvas wrap is a mirrored bleed; mirroring out-of-range coords matches what prints there. */
const mirror = (t: number) => (t < 0 ? -t : t > 1 ? 2 - t : t);

/** Place a flat preview (exactly what prints) onto the calibrated product photo. WebP with alpha. */
export const renderMockup = async (cal: MockupCalibration, preview: Buffer) => {
  const { photo, alpha, uv } = await prepare(cal);
  const art = await sharp(preview)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const aw = art.info.width,
    ah = art.info.height,
    A = art.data;
  const out = Buffer.from(photo);
  const [x0, y0, x1, y1] = cal.bbox,
    bw = x1 - x0 + 1,
    W = cal.width;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x,
        a = alpha[i];
      if (a <= 0) {
        continue;
      }
      const o2 = ((y - y0) * bw + (x - x0)) * 2;
      const u = Math.max(0, Math.min(1, mirror(uv[o2]))),
        v = Math.max(0, Math.min(1, mirror(uv[o2 + 1])));
      const fx = u * (aw - 1),
        fy = v * (ah - 1);
      const xa = Math.floor(fx),
        ya = Math.floor(fy),
        xb = Math.min(xa + 1, aw - 1),
        yb = Math.min(ya + 1, ah - 1);
      const tx = fx - xa,
        ty = fy - ya;
      const w00 = (1 - tx) * (1 - ty),
        w10 = tx * (1 - ty),
        w01 = (1 - tx) * ty,
        w11 = tx * ty;
      const p00 = (ya * aw + xa) * 4,
        p10 = (ya * aw + xb) * 4,
        p01 = (yb * aw + xa) * 4,
        p11 = (yb * aw + xb) * 4;
      const artA =
        (A[p00 + 3] * w00 +
          A[p10 + 3] * w10 +
          A[p01 + 3] * w01 +
          A[p11 + 3] * w11) /
        255;
      const k = a * artA;
      for (let c = 0; c < 3; c++) {
        const s =
          A[p00 + c] * w00 +
          A[p10 + c] * w10 +
          A[p01 + c] * w01 +
          A[p11 + c] * w11;
        const base = photo[i * 4 + c];
        out[i * 4 + c] = Math.round(base * (1 - k) + s * (base / 255) * k);
      }
    }
  }

  const buffer = await sharp(out, {
    raw: { width: W, height: cal.height, channels: 4 },
  })
    .webp({ quality: 84, alphaQuality: 90 })
    .toBuffer();
  return { buffer, width: W, height: cal.height };
};
