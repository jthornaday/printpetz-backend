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
  // WRAP IS 3in PER SIDE, NOT 1.5 (measured 2026-09-26). Printful's canvas 16x20 printfile
  // is 6600x7800 @300 = 22x26in with fill=cover: the 16x20 face plus 3in per side for the
  // wrap. Our old 19x23in file (1.5in bleed) was scaled up 1.158x to cover it, pushing
  // ~6.8% of the art off each edge of the face. A dot-grid mockup through Printful showed
  // exactly the predicted 11 of 13 columns and 14 of 16 rows on the face. With 3in of
  // mirrored bleed the file IS 22x26in, Printful doesn't scale it, and the face shows the
  // intended 16x20. 4400x5200 @200 DPI.
  canvas_16x20: {
    key: "canvas_16x20", label: '16x20" gallery-wrap canvas',
    widthIn: 16, heightIn: 20, dpi: 200, bleedIn: 3, defaultTreatment: "panel",
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
  // Renamed from "koozie" 2026-09-23 to match the Shopify product. "Koozie" is a
  // trademark (Koozie Group); Printful lists it as "Can Cooler", which is why it
  // could not be found by that name. Catalog product 764.
  // Size is Printful's own printfile for the REGULAR variant (19461): 1260x1528 @300,
  // fill=cover (read from /mockup-generator/printfiles/764, 2026-09-26). The old 3.5x4
  // estimate lost ~6% of the width to Printful's crop. Slim (19462) is 1076x2085 —
  // a different shape entirely — and is not sold until it has its own row.
  can_cooler: {
    key: "can_cooler", label: "Can cooler",
    widthIn: 4.2, heightIn: 5.0933, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
  },
  // Shaker Pint Glass, catalog 653 / variant 16359. Real spec from Printful's File
  // guidelines, 2026-09-23: print file 9.58in x 5.04in @300 DPI = 2874x1512.
  //
  // NOT SELLABLE YET, and the dimensions below say why: 1.9:1 LANDSCAPE against a
  // 0.81 portrait source. A centre-crop yields a horizontal slice of dog. Like a
  // wrap mug, this needs composition — the pet placed as a panel on a wider canvas —
  // not a crop. That is real work, not a table row.
  //
  // The key stays so the three catalogs agree. It is hidden from the frontend
  // picker, so nothing can order one until the composition step exists.
  pint_glass_16oz: {
    key: "pint_glass_16oz", label: "16oz shaker pint glass (NOT SELLABLE — needs wrap composition)",
    widthIn: 9.58, heightIn: 5.04, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
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
