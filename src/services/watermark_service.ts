/**
 * The watermark on images made with free starter credits (specs/free-credits-watermark.md).
 *
 * A diagonal tiled "PrintPetz" wordmark over the whole image (it can't be cropped out) plus a
 * royal-blue "printpetz.com" badge in the corner. White fill with a faint dark outline so it reads
 * on black and white coats alike, kept light so the pet's face can still be judged.
 *
 * Letters are drawn as paths from the bundled Archivo Black (name_text.ts), never as SVG text,
 * so the server's fonts are never involved. Products never get this: they print from the clean
 * original.
 */
import sharp from "sharp";

import { linePathData, lineWidth } from "./name_text";

const WORD = "PrintPetz";
const BADGE = "printpetz.com";
const BLUE = "#2454df";

const svgFor = (W: number, H: number) => {
  // Tile size scales with the image so it looks the same on a preview and a full-size download.
  const fontPx = Math.round(Math.min(W, H) * 0.06);
  const wordW = lineWidth(WORD, fontPx, 0.02);
  const stepX = wordW * 1.9,
    stepY = fontPx * 3.4;
  const word = linePathData(WORD, 0, 0, fontPx, 0.02);
  // Enough rows and columns to cover the rotated canvas from corner to corner.
  const reach = Math.hypot(W, H);
  const uses: string[] = [];
  for (
    let row = -Math.ceil(reach / stepY);
    row <= Math.ceil(reach / stepY);
    row++
  ) {
    const offset = row % 2 ? stepX / 2 : 0;
    for (
      let col = -Math.ceil(reach / stepX);
      col <= Math.ceil(reach / stepX);
      col++
    ) {
      uses.push(
        `<use xlink:href="#w" x="${(W / 2 + col * stepX + offset).toFixed(1)}" y="${(H / 2 + row * stepY).toFixed(1)}"/>`,
      );
    }
  }
  const badgePx = Math.round(Math.min(W, H) * 0.032);
  const badgeW = lineWidth(BADGE, badgePx, 0.01),
    padX = badgePx * 0.7,
    padY = badgePx * 0.55;
  const boxW = badgeW + padX * 2,
    boxH = badgePx * 0.75 + padY * 2;
  const boxX = W - boxW - badgePx,
    boxY = H - boxH - badgePx;
  const badge = linePathData(
    BADGE,
    boxX + padX,
    boxY + padY + badgePx * 0.75,
    badgePx,
    0.01,
  );
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">` +
      `<defs><path id="w" d="${word}"/></defs>` +
      `<g transform="rotate(-30 ${W / 2} ${H / 2})" fill="#ffffff" fill-opacity="0.2" stroke="#000000" stroke-opacity="0.16" stroke-width="${(fontPx * 0.025).toFixed(2)}">${uses.join("")}</g>` +
      `<rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${boxW.toFixed(1)}" height="${boxH.toFixed(1)}" rx="${(boxH / 2).toFixed(1)}" fill="${BLUE}"/>` +
      `<path d="${badge}" fill="#ffffff"/>` +
      `</svg>`,
  );
};

/** Watermarked copy of an image, in the same format (JPEG stays JPEG, PNG stays PNG). */
export const watermark = async (input: Buffer) => {
  const meta = await sharp(input).metadata();
  const W = meta.width ?? 0,
    H = meta.height ?? 0;
  if (!W || !H) {
    throw new Error("watermark: image has no size");
  }
  const out = sharp(input).composite([
    { input: svgFor(W, H), left: 0, top: 0 },
  ]);
  return meta.format === "png"
    ? out.png().toBuffer()
    : out.jpeg({ quality: 92 }).toBuffer();
};
