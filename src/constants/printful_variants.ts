/**
 * PrintPetz product key -> Printful catalog variant id.
 *
 * Looked up against Printful's live catalog on 2026-09-23, not copied from docs.
 * Adding a SKU is a line here plus a row in print_products.ts.
 *
 * Prices are recorded for reference only — Printful changes them and this file is
 * not the source of truth for cost. Always read live pricing before quoting margin.
 */

export type PrintfulVariant = {
  variantId: number;
  /** Printful catalog product id the variant belongs to. For traceability. */
  productId: number;
  label: string;
  /** Base cost in USD when looked up. Reference only, not authoritative. */
  priceUsdAtLookup: number;
};

export const PRINTFUL_VARIANTS: Record<string, PrintfulVariant> = {
  poster_8x10: {
    variantId: 4463, productId: 1,
    label: 'Enhanced Matte Paper Poster (in) — 8″×10″', priceUsdAtLookup: 7.03,
  },
  framed_8x10: {
    variantId: 4651, productId: 2,
    label: 'Enhanced Matte Paper Framed Poster (in) — 8″×10″, Black',
    priceUsdAtLookup: 20.76,
  },
  canvas_16x20: {
    variantId: 6, productId: 3,
    label: 'Canvas (in) — 16″×20″', priceUsdAtLookup: 28.56,
  },
  coaster_4x4: {
    variantId: 15662, productId: 611,
    label: 'Cork-Back Coaster — 3.74″×3.74″', priceUsdAtLookup: 5.55,
  },
  mug_11oz: {
    variantId: 1320, productId: 19,
    label: 'White Glossy Mug — 11 oz', priceUsdAtLookup: 6.07,
  },
  koozie: {
    variantId: 19461, productId: 764,
    label: 'Can Cooler — Regular 12 oz, White', priceUsdAtLookup: 3.49,
  },
  pillow_18x18: {
    variantId: 4532, productId: 83,
    label: 'All-Over Print Basic Pillow — 18″×18″', priceUsdAtLookup: 16.60,
  },
};

export const variantForProduct = (productKey: string): PrintfulVariant => {
  const v = PRINTFUL_VARIANTS[productKey];
  if (!v) {
    throw new Error(
      `No Printful variant mapped for product "${productKey}". ` +
      `Known: ${Object.keys(PRINTFUL_VARIANTS).join(", ")}`,
    );
  }
  return v;
};
