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
  /**
   * Where the art can safely go on this product's face. Some of the print file is lost on the
   * physical product — an ornament's hanging hole, a can cooler's bottom tab, a pillow's seams.
   * The art is placed uncropped at artAspect in a box from `top` to `1 - bottom` of the face
   * height (centred), and the rest of the face is a soft blurred continuation of the same image,
   * so what's lost is background, never the pet or its name. Fractions of the visible face,
   * measured from Printful's own renders (merch-calibrate coverage mapped into art coords).
   */
  safeArea?: { top: number; bottom: number; artAspect: number };
  /**
   * Wrap-around band (pet bowl). A lockup — the portrait plus the pet's printed display name — is
   * centred on the front (x = W/2), with single portraits at W/2 + sideCentres·W. If the name can't
   * print (none, unsupported characters, too long) the band is portraits only at fallbackCentres.
   * Pixel values are in print-file space; smaller renders (previews) scale them. Nothing may be
   * printed within seamClearancePx of the ends, which meet at the back. Spec: merch-pet-bowl.md.
   */
  band?: {
    portraitAspect: number;
    portraitHeight: number; // fraction of the face height
    sideCentres: number[]; // offsets from W/2, fraction of W
    fallbackCentres: number[];
    lockup: { gapPx: number; maxWidthPx: number; color: string; maxFontPx: number; twoLineMaxFontPx: number; minFontPx: number; tracking: number };
    seamClearancePx: number;
    previewWidth: number;
  };
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
    // Measured 2026-09-28: full width visible from v 0.03 to ~0.81; below that only the centre tab
    // (u 0.22-0.78) shows, so the art's bottom corners — usually paws — were lost.
    safeArea: { top: 0.05, bottom: 0.21, artAspect: 0.8 },
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
    // Measured 2026-09-28: ~6-8% of the file is lost into the seams on every side (visible u and v
    // ~0.06..0.94). The art sits inside that, uncropped (it was a 19% square crop before).
    safeArea: { top: 0.09, bottom: 0.09, artAspect: 0.8 },
  },
  // Holiday line, 2026-09-27. All three sizes are Printful's own printfiles
  // (/mockup-generator/printfiles), not product-page dimensions.
  // Ceramic Ornament 2-Side (product 900, Circle 23133): 954x954 @300, cover. One file, printed
  // on both faces. The circle itself trims the corners — the mockup shows exactly how much.
  ornament_ceramic_circle: {
    key: "ornament_ceramic_circle", label: 'Ceramic ornament, 3.18" circle, 2-sided',
    widthIn: 3.18, heightIn: 3.18, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
    // Measured 2026-09-28: hole centre at 0.170, bottom 0.198; the disc itself is inset 6.7% per
    // side (2.76" across). 0.23..0.85 keeps a 4:5 art box inside the circle below the hole.
    safeArea: { top: 0.23, bottom: 0.15, artAspect: 0.8 },
  },
  // Metal Christmas Ornament (product 901, Oval 23135): 525x650 @200, cover. Almost exactly our
  // 4:5 art, so nearly nothing is cropped. Front only; the back prints nothing for now.
  ornament_metal_oval: {
    key: "ornament_metal_oval", label: 'Metal Christmas ornament, oval',
    widthIn: 2.625, heightIn: 3.25, dpi: 200, bleedIn: 0, defaultTreatment: "panel",
    // Measured 2026-09-28: hole centre at 0.126, bottom 0.161 (edge to edge it punched every
    // pet's cap and name). Jake chose "placed below the hole".
    safeArea: { top: 0.19, bottom: 0.05, artAspect: 0.8 },
  },
  // Pet Bowl (product 678; 18 oz 16785, 32 oz 16786 — same printfile): one wrap-around band,
  // 6496x803 @300 (21.65 x 2.68 in), fill=fit. Printful's front view shows x = W/2. Design "B2"
  // (Jake, 2026-09-28): portrait + UPPERCASE display name on the front, portraits at the sides.
  pet_bowl: {
    key: "pet_bowl", label: "Pet bowl, wrap-around band",
    widthIn: 6496 / 300, heightIn: 803 / 300, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
    band: {
      portraitAspect: 0.8,
      portraitHeight: 700 / 803,
      sideCentres: [-1 / 3, 1 / 3],
      fallbackCentres: [-0.4, -0.2, 0, 0.2, 0.4],
      lockup: { gapPx: 60, maxWidthPx: 2400, color: "#14264f", maxFontPx: 540, twoLineMaxFontPx: 417, minFontPx: 180, tracking: 0.056 },
      seamClearancePx: 75,
      previewWidth: 2600,
    },
  },
  // Greeting Card 4x6 (product 568, variant 14457), made in the US (5x7 and A5 are EU-only).
  // Printful's printfile is 1842x1240 landscape with can_rotate; we send it portrait, 1240x1842.
  card_4x6: {
    key: "card_4x6", label: 'Greeting card, 4x6" portrait',
    widthIn: 4.1333, heightIn: 6.14, dpi: 300, bleedIn: 0, defaultTreatment: "panel",
  },
};

export const productAspect = (p: PrintProduct) => p.widthIn / p.heightIn;

/** Shape the art is cropped to: the product's own, or its safe-area box's. */
export const artAspect = (p: PrintProduct) => p.band?.portraitAspect ?? p.safeArea?.artAspect ?? productAspect(p);

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
  const target = artAspect(p);
  const lost = target > SOURCE_ASPECT
    ? 1 - SOURCE_ASPECT / target   // height removed
    : 1 - target / SOURCE_ASPECT;  // width removed
  return lost > SUBJECT_CROP_THRESHOLD;
};

export const isProductKey = (k: string): k is keyof typeof PRINT_PRODUCTS =>
  Object.prototype.hasOwnProperty.call(PRINT_PRODUCTS, k);
