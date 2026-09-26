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
  /** Product options Printful REQUIRES on every order line, or it rejects the order. */
  options?: Array<{ id: string; value: string }>;
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
  can_cooler: {
    variantId: 19461, productId: 764,
    label: "Can Cooler — Regular 12 oz, White", priceUsdAtLookup: 3.49,
  },
  // Shopify sells Regular and Slim; M3 maps one Printful variant per product key, so
  // Slim (19462) currently falls through to Regular. If Slim must print differently,
  // this needs a size dimension like the frontend catalog has.
  pint_glass_16oz: {
    variantId: 16359, productId: 653,
    label: "Shaker Pint Glass (16 oz)", priceUsdAtLookup: 15.26,
  },
  pillow_18x18: {
    variantId: 4532, productId: 83,
    label: 'All-Over Print Basic Pillow — 18″×18″', priceUsdAtLookup: 16.60,
    // Required by Printful ("Zipper & Stitch color": white | black). Without it every
    // pillow order is rejected with a 400 — reproduced with a draft order 2026-09-26.
    options: [{ id: "stitch_color", value: "white" }],
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

/**
 * Shopify variant id -> Printful catalog variant id.
 *
 * The SIZE a customer paid for lives on the Shopify line item's `variant_id`, not in
 * our `_product_key` attribute (which picks the print-file spec and is the same for
 * every mug size). Before this map existed, every mug printed as 11 oz and every can
 * cooler as Regular — proven by a real order on 2026-09-26: 20 oz ordered, 11 oz sent.
 *
 * Shopify ids pulled from the Storefront API 2026-09-23. A new Shopify variant that is
 * not listed here falls back to the product key's default variant and logs a warning.
 */
export const SHOPIFY_VARIANT_TO_PRINTFUL: Record<string, { printfulVariantId: number; label: string }> = {
  "50526265999618": { printfulVariantId: 1320,  label: "Mug 11 oz" },
  "50526266032386": { printfulVariantId: 4830,  label: "Mug 15 oz" },
  "50526266065154": { printfulVariantId: 16586, label: "Mug 20 oz" },
  "50526390026498": { printfulVariantId: 4463,  label: "Poster 8x10" },
  "50526391402754": { printfulVariantId: 4651,  label: "Framed poster 8x10, black" },
  "50526379507970": { printfulVariantId: 6,     label: "Canvas 16x20" },
  "50526403592450": { printfulVariantId: 15662, label: "Cork-back coaster" },
  "50526510252290": { printfulVariantId: 19461, label: "Can cooler, regular 12 oz" },
  "50526510285058": { printfulVariantId: 19462, label: "Can cooler, slim 12 oz" },
  "50526365614338": { printfulVariantId: 4532,  label: "Pillow 18x18" },
  "50526392549634": { printfulVariantId: 16359, label: "Shaker pint glass 16 oz" },
};

export const printfulVariantForShopify = (shopifyVariantId: unknown) =>
  shopifyVariantId == null ? null : SHOPIFY_VARIANT_TO_PRINTFUL[String(shopifyVariantId)] ?? null;
