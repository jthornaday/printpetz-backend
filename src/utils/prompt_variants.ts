// Per-image pose variation. A theme may carry a `variants` array in the styles
// table: 3-5 short phrases describing action, camera framing and a setting
// detail. Image i in a batch takes one of them, so four images of the same
// theme are four different shots rather than four attempts at one shot.
//
// Deliberately narrow. A variant never states posture — the global POSE line
// owns "upright on hind legs" and a variant that disagreed with it would put
// two postures in one prompt. It never states wardrobe, which base_prompt owns,
// and never describes the pet, which the LoRA and the IDENTITY block own.

// 14 rather than 18: the longest assembled prompt already sits near 350 tokens,
// and a 14-word cap keeps the worst case far enough under the 400 ceiling to
// survive a long pet_description on top.
export const VARIANT_MAX_WORDS = 14;

// `variants` is jsonb, so it can legally hold a number, an object or a mixed
// array, and the column's CHECK constraint only guards rows written after it
// landed. Nothing here throws: an unusable value means "this theme has no
// variants", which is exactly how every theme behaved before the column
// existed.
const toUsableList = (variants: unknown, styleName?: string): string[] => {
  if (variants === null || variants === undefined) return [];

  if (!Array.isArray(variants)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[variants] styles.variants for style="${styleName ?? "unknown"}" is ${typeof variants}, not an array. Ignoring it.`,
    );
    return [];
  }

  const usable = variants
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (usable.length !== variants.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[variants] style="${styleName ?? "unknown"}" has ${variants.length} entries but only ${usable.length} are non-empty strings. Using the usable ones.`,
    );
  }

  return usable;
};

// `rotationIndex` is the image index plus whatever offset the caller chose, so
// the decision about *how* batches rotate stays with the caller.
export const getVariantForImage = (
  variants: unknown,
  rotationIndex: number,
  styleName?: string,
): string => {
  const usable = toUsableList(variants, styleName);
  if (!usable.length) return "";

  const chosen = usable[rotationIndex % usable.length];
  const words = chosen.split(" ");

  if (words.length > VARIANT_MAX_WORDS) {
    // eslint-disable-next-line no-console
    console.warn(
      `[variants] style="${styleName ?? "unknown"}" variant is ${words.length} words, over the ${VARIANT_MAX_WORDS}-word cap. Truncating.`,
    );
    return words.slice(0, VARIANT_MAX_WORDS).join(" ").replace(/[,;:.\s]+$/, "");
  }

  return chosen;
};
