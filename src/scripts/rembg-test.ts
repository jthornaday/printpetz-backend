/**
 * Scratch: does rembg cut cleanly around pet fur?
 *
 * Runs the 4x Lanczos upscale of each pet through fal-ai/imageutils/rembg and
 * writes a transparent PNG plus a dark-garment mockup. Wizard and Moses are the
 * hard cases: thin bright whiskers on black fur, and a wispy curly coat.
 *
 *   node -r module-alias/register lib/scripts/rembg-test.js
 */
import "module-alias/register";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import fs from "node:fs";
import path from "node:path";
import { fal } from "@fal-ai/client";
import AppConstants from "@/constants/app_constants";

fal.config({ credentials: AppConstants.falApiKey });

const BASE = path.join(process.cwd(), "Claude outputs", "upscale-eval");
const PETS = (process.argv.find((a) => a.startsWith("--pets="))?.split("=")[1] ?? "Wizard,Moses").split(",");

const main = async () => {
  for (const pet of PETS) {
    const src = path.join(BASE, pet, "lanczos-4x.png");
    if (!fs.existsSync(src)) { console.log(`  SKIP ${pet}: no ${src}`); continue; }

    const t0 = Date.now();
    try {
      const blob = new Blob([new Uint8Array(fs.readFileSync(src))], { type: "image/png" });
      const url = await fal.storage.upload(blob as unknown as File);

      const result: any = await fal.subscribe("fal-ai/imageutils/rembg", {
        input: { image_url: url, crop_to_bbox: false },
      });
      const out = result?.data?.image;
      if (!out?.url) throw new Error("no image returned");

      const res = await fetch(out.url);
      const buf = Buffer.from(await res.arrayBuffer());
      const dest = path.join(BASE, pet, "rembg-4x.png");
      fs.writeFileSync(dest, buf);
      console.log(`  ok     ${pet}  ${Date.now() - t0}ms  ${out.width}x${out.height}  -> ${dest}`);
    } catch (e: any) {
      console.log(`  FAILED ${pet}  ${Date.now() - t0}ms  ${e?.message ?? e}`);
    }
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
