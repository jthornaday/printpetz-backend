/**
 * CLI wrapper around the print-file service.
 *
 *   npm run print-file -- --image=path/to.jpg --product=poster_8x10
 *   npm run print-file -- --image=path/to.jpg --product=canvas_16x20 --treatment=cutout
 *   npm run print-file -- --list
 *
 * Thin on purpose — the real work is buildPrintFile(), so M3 can call it directly.
 */
import "module-alias/register";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import fs from "node:fs";
import path from "node:path";

import { PRINT_PRODUCTS, outputSize, needsSubjectAwareCrop, Treatment } from "@/constants/print_products";
import { buildPrintFile } from "@/services/print_file_service";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const listProducts = () => {
  console.log("\nproduct           size        dpi  bleed  output px     subject-crop");
  console.log("-".repeat(74));
  for (const p of Object.values(PRINT_PRODUCTS)) {
    const s = outputSize(p);
    console.log(
      `${p.key.padEnd(17)} ${`${p.widthIn}x${p.heightIn}in`.padEnd(11)} ${String(p.dpi).padEnd(4)} ` +
      `${`${p.bleedIn}in`.padEnd(6)} ${`${s.fullW}x${s.fullH}`.padEnd(13)} ${needsSubjectAwareCrop(p) ? "yes" : "no"}`,
    );
  }
  console.log("\ntreatments: panel (full scene) | cutout (background removed)\n");
};

const main = async () => {
  if (process.argv.includes("--list")) return listProducts();

  const image = arg("image");
  const product = arg("product");
  const treatment = (arg("treatment") ?? "panel") as Treatment;
  const outDir = arg("out") ?? path.dirname(image ?? ".");

  if (!image || !product) {
    console.error("usage: --image=<path> --product=<key> [--treatment=panel|cutout] [--out=<dir>]");
    console.error("       --list  to see products");
    process.exit(1);
  }
  if (!fs.existsSync(image)) {
    console.error(`image not found: ${image}`);
    process.exit(1);
  }
  if (treatment !== "panel" && treatment !== "cutout") {
    console.error(`treatment must be panel or cutout, got "${treatment}"`);
    process.exit(1);
  }

  const started = Date.now();
  const r = await buildPrintFile(fs.readFileSync(image), product, treatment);

  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(image).replace(/\.[^.]+$/, "");
  const dest = path.join(outDir, `${base}--${product}--${treatment}.${r.format}`);
  fs.writeFileSync(dest, r.buffer);

  console.log(`\n${r.product.label}  [${r.treatment}]`);
  console.log(`  ${r.width}x${r.height} px @ ${r.dpi} DPI  (${(r.width / r.dpi).toFixed(2)}x${(r.height / r.dpi).toFixed(2)} in)`);
  console.log(`  ${r.format.toUpperCase()}  ${(r.buffer.length / 1048576).toFixed(1)} MB  ${Date.now() - started}ms`);
  if (r.subjectBbox) {
    const b = r.subjectBbox;
    console.log(`  subject bbox: ${b.width}x${b.height} at (${b.left},${b.top})`);
  }
  for (const n of r.notes) console.log(`  - ${n}`);
  console.log(`  -> ${dest}\n`);
};

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
