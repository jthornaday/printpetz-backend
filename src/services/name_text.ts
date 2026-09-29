/**
 * The pet's display name as printable shapes. Used by products that print the name (pet bowl).
 *
 * The name is laid out with opentype.js from the bundled Archivo Black font and emitted as SVG
 * path data, so the server's font system is never involved: on Elastic Beanstalk a missing font
 * would otherwise be silently swapped for another typeface. Either the file loads or this throws.
 * The name never enters SVG as text, so there is nothing to escape.
 *
 * Spec: specs/merch-pet-bowl.md ("Normalising the name", "Auto-fit").
 */
import path from "node:path";

import opentype from "opentype.js";

const FONT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "assets",
  "fonts",
  "ArchivoBlack-Regular.ttf",
);

let font: opentype.Font | null = null;
const getFont = () => {
  if (!font) {
    font = opentype.loadSync(FONT_PATH);
  }
  return font;
};

export type NameOmitted = "no_name" | "unsupported_characters" | "too_long";

/**
 * Normalise a display name for printing, or say why it can't print. Uppercase like the jersey
 * lettering; emoji stripped ("Max 🐶" -> "MAX"); any character the font lacks (Cyrillic, CJK…)
 * omits the whole name rather than dropping letters or printing a box.
 */
export const printableName = (
  raw: string | null | undefined,
): { name: string } | { omitted: NameOmitted } => {
  if (!raw || !raw.trim()) {
    return { omitted: "no_name" };
  }
  const cleaned = raw
    .normalize("NFC")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("en-US");
  if (!cleaned) {
    return { omitted: "no_name" };
  }
  if (cleaned.length > 30) {
    return { omitted: "too_long" };
  }
  const f = getFont();
  for (const ch of cleaned) {
    if (ch !== " " && f.charToGlyphIndex(ch) <= 0) {
      return { omitted: "unsupported_characters" };
    }
  }
  return { name: cleaned };
};

/** Rendered width of one line at a font size: advances + kerning + tracking (em). */
export const lineWidth = (text: string, fontPx: number, tracking: number) => {
  const f = getFont();
  const glyphs = f.stringToGlyphs(text);
  const scale = fontPx / f.unitsPerEm;
  let w = 0;
  glyphs.forEach((g, i) => {
    w += (g.advanceWidth ?? 0) * scale;
    if (i < glyphs.length - 1) {
      w += f.getKerningValue(g, glyphs[i + 1]) * scale + tracking * fontPx;
    }
  });
  return w;
};

export type NameFit = {
  maxWidthPx: number;
  maxFontPx: number;
  twoLineMaxFontPx: number;
  minFontPx: number;
  tracking: number;
};

/**
 * Largest size at which the name fits the box: one line, or — if one line would be small and
 * the name has 2+ words — the most balanced two-line split, whichever is larger. Below the floor
 * the name is omitted (too_long) and the product prints portraits only.
 */
export const fitName = (
  name: string,
  fit: NameFit,
): { lines: string[]; fontPx: number } | { omitted: "too_long" } => {
  const sizeFor = (lines: string[], cap: number) => {
    const at100 = Math.max(
      ...lines.map((l) => lineWidth(l, 100, fit.tracking)),
    );
    return Math.min(cap, Math.floor((fit.maxWidthPx / at100) * 100));
  };
  let best = { lines: [name], fontPx: sizeFor([name], fit.maxFontPx) };
  const words = name.split(" ");
  if (best.fontPx < 360 && words.length >= 2) {
    for (let k = 1; k < words.length; k++) {
      const lines = [words.slice(0, k).join(" "), words.slice(k).join(" ")];
      const px = sizeFor(lines, fit.twoLineMaxFontPx);
      if (px > best.fontPx) {
        best = { lines, fontPx: px };
      }
    }
  }
  return best.fontPx < fit.minFontPx ? { omitted: "too_long" } : best;
};

/** Cap height as a fraction of the font size (for vertical centring). */
export const capHeightEm = () => {
  const f = getFont();
  const os2 = (f.tables as { os2?: { sCapHeight?: number } }).os2;
  return (os2?.sCapHeight ?? 0.7 * f.unitsPerEm) / f.unitsPerEm;
};

/** SVG path data for one line starting at (x, baselineY), with tracking. */
export const linePathData = (
  text: string,
  x: number,
  baselineY: number,
  fontPx: number,
  tracking: number,
) => {
  const f = getFont();
  const glyphs = f.stringToGlyphs(text);
  const scale = fontPx / f.unitsPerEm;
  let cx = x,
    d = "";
  glyphs.forEach((g, i) => {
    d += g.getPath(cx, baselineY, fontPx).toPathData(2);
    cx += (g.advanceWidth ?? 0) * scale;
    if (i < glyphs.length - 1) {
      cx += f.getKerningValue(g, glyphs[i + 1]) * scale + tracking * fontPx;
    }
  });
  return d;
};
