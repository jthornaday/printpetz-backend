/**
 * Print product catalog.
 *
 * Adding a product should be a row here, not code. Sizes for mug, koozie and
 * coaster are estimates — confirm against the provider's own spec before selling
 * them and correct the numbers here.
 *
 * Source generations are 832x1024 (4:5). See specs/merch-m1-print-file-service.md.
 */

export type Treatment = "panel" | "cutout";

export type PrintProduct = {
  key: string;
  label: string;
  /** Visible printed area, inches. Excludes bleed. */
  widthIn: number;
  heightIn: number;
  dpi: number;
  /** Gallery-wrap or trim bleed, inches per side. 0 for most products. */
  bleedIn: number;
  /** What the storefront shows first. Both treatments stay available. */
  defaultTreatment: Treatment;
};

export const SOURCE_ASPECT = 832 / 1024; // 0.8125

/**
 * A crop removing more than this fraction of either edge needs to be aimed at the
 * subject rather than the image centre, or it clips ears.
 */
export const SUBJECT_CROP_THRESHOLD = 0.05;

export const PRINT_PRODUCTS: Record<string, PrintProduct> = {
  poster_8x10: {
    key: "poster_8x10", label: '8x10" poster',
    widthIn: 8, heightIn: 10, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
  },
  framed_8x10: {
    key: "framed_8x10", label: '8x10" framed print',
    widthIn: 8, heightIn: 10, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
  },
  // Verified 2026-09-22 in Printful's design tool: the 3800x4600 file (16x20
  // visible + our own 1.5in mirrored bleed) was ACCEPTED at 200 DPI with NO
  // resolution warning, despite Printful's stated 300 DPI recommendation for
  // canvas. Their hard floor is 150.
  //
  // UNRESOLVED RISK — verify on the first physical canvas order before selling any:
  // if Printful applies its OWN gallery wrap on top of our pre-mirrored bleed, the
  // printed visible face loses an extra 1.5in on every edge. A mockup cannot show
  // this; it renders from the same file whether or not they wrap it again. If the
  // first real canvas comes back cropped tighter than the mockup, set bleedIn to 0
  // and output the flat 3200x4000 instead.
  canvas_16x20: {
    key: "canvas_16x20", label: '16x20" gallery-wrap canvas',
    widthIn: 16, heightIn: 20, dpi: 200, bleedIn: 1.5, defaultTreatment: "panel",
  },
  // Printful's Cork-Back Coaster (catalog product 611, variant 15662) is
  // 3.74in x 3.74in exactly, per the live catalog on 2026-09-23. Not 4x4, and not
  // the 3.75 I had from secondary sources. 3.74 x 300 DPI = 1122x1122.
  coaster_4x4: {
    key: "coaster_4x4", label: '3.74" cork-back coaster',
    widthIn: 3.74, heightIn: 3.74, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
  },
  // Printful White Glossy Mug uses a SIDE PLACEMENT, not a full wrap. Verified
  // 2026-09-22 by uploading Darla-8x10-300dpi.jpg (2400x3000) into Printful's
  // design tool: accepted with no resolution warning, mockups rendered correctly.
  // So the poster file doubles as the mug file — same 8x10 4:5 asset, no separate
  // pipeline. Wrap-style mugs from other suppliers ARE landscape (~8.5x3.5in) and
  // would need their own composition; do not assume this row covers those.
  mug_11oz: {
    key: "mug_11oz", label: "11oz mug (side placement)",
    widthIn: 8, heightIn: 10, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
  },
  koozie: {
    key: "koozie", label: "Can koozie",
    widthIn: 3.5, heightIn: 4, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
  },
  pillow_18x18: {
    key: "pillow_18x18", label: '18x18" decorative pillow',
    widthIn: 18, heightIn: 18, dpi: 150, bleedIn: 0, defaultTreatment: "panel",
  },
};

export const productAspect = (p: PrintProduct) => p.widthIn / p.heightIn;

/** Final file dimensions in pixels, bleed included. */
export const outputSize = (p: PrintProduct) => ({
  visibleW: Math.round(p.widthIn * p.dpi),
  visibleH: Math.round(p.heightIn * p.dpi),
  bleedPx: Math.round(p.bleedIn * p.dpi),
  fullW: Math.round((p.widthIn + 2 * p.bleedIn) * p.dpi),
  fullH: Math.round((p.heightIn + 2 * p.bleedIn) * p.dpi),
});

/**
 * True when cropping to this product's aspect discards enough of the frame that a
 * blind centre-crop would risk clipping the pet.
 */
export const needsSubjectAwareCrop = (p: PrintProduct) => {
  const target = productAspect(p);
  const lost = target > SOURCE_ASPECT
    ? 1 - SOURCE_ASPECT / target   // height removed
    : 1 - target / SOURCE_ASPECT;  // width removed
  return lost > SUBJECT_CROP_THRESHOLD;
};

export const isProductKey = (k: string): k is keyof typeof PRINT_PRODUCTS =>
  Object.prototype.hasOwnProperty.call(PRINT_PRODUCTS, k);
