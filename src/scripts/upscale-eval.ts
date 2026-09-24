/**
 * PrintPetz — M0 upscale evaluation.
 *
 * Answers one question: can any upscaler take a 1024px generation to print
 * resolution without changing the pet?
 *
 * Run it:
 *   npm run build
 *   node -r module-alias/register lib/scripts/upscale-eval.js --probe
 *       # one pet, one upscaler, cheapest factor. Prints measured cost. Spends a few cents.
 *   node -r module-alias/register lib/scripts/upscale-eval.js --confirm
 *       # the full matrix
 *
 * Reads originals from "Claude outputs/upscale-eval/<pet>/original.jpg" and writes
 * "<pet>/<upscaler>-<factor>x.png" beside them. Touches no database, no S3, and
 * nothing in the live generation path.
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
const PETS = ["Wizard", "Moses", "George", "Max", "Darla"];
const BUDGET_USD = 20;

type Candidate = {
  name: string;
  endpoint: string;
  factors: number[];
  kind: "conservative" | "creative";
  input: (url: string, factor: number) => Record<string, unknown>;
};

// Conservative first — these enlarge without inventing detail. Clarity is included
// to demonstrate the failure mode, not because it is expected to pass.
const CANDIDATES: Candidate[] = [
  {
    name: "esrgan",
    endpoint: "fal-ai/esrgan",
    factors: [2, 3, 4],
    kind: "conservative",
    input: (image_url, scale) => ({ image_url, scale, model: "RealESRGAN_x4plus" }),
  },
  {
    name: "aura-sr",
    endpoint: "fal-ai/aura-sr",
    factors: [4],
    kind: "conservative",
    input: (image_url) => ({ image_url, upscaling_factor: 4 }),
  },
  {
    name: "clarity",
    endpoint: "fal-ai/clarity-upscaler",
    factors: [2, 4],
    kind: "creative",
    // Lowest creativity/highest resemblance the endpoint allows. If this still
    // repaints the pet, no creative upscaler is usable here.
    input: (image_url, upscale_factor) => ({
      image_url,
      upscale_factor,
      creativity: 0,
      resemblance: 1,
guidance_scale: 1,
      num_inference_steps: 18,
    }),
  },
];

type Row = {
  pet: string;
  upscaler: string;
  factor: number;
  ok: boolean;
  ms: number;
  costUsd: number | null;
  width: number | null;
  height: number | null;
  file: string | null;
  error: string | null;
};

const uploadOriginal = async (pet: string): Promise<string> => {
  const p = path.join(BASE, pet, "original.jpg");
  if (!fs.existsSync(p)) throw new Error(`missing original: ${p}`);
  const buf = fs.readFileSync(p);
  const blob = new Blob([new Uint8Array(buf)], { type: "image/jpeg" });
  return fal.storage.upload(blob as unknown as File);
};

const runOne = async (
  pet: string,
  url: string,
  c: Candidate,
  factor: number,
): Promise<Row> => {
  const started = Date.now();
  const row: Row = {
    pet, upscaler: c.name, factor, ok: false, ms: 0,
    costUsd: null, width: null, height: null, file: null, error: null,
  };
  try {
    const result: any = await fal.subscribe(c.endpoint, { input: c.input(url, factor) });
    row.ms = Date.now() - started;

    const out = result?.data?.image ?? result?.data?.images?.[0] ?? result?.image;
    if (!out?.url) throw new Error(`no image in response: ${JSON.stringify(result?.data ?? result).slice(0, 300)}`);

    row.width = out.width ?? null;
    row.height = out.height ?? null;

    const res = await fetch(out.url);
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const file = path.join(BASE, pet, `${c.name}-${factor}x.png`);
    fs.writeFileSync(file, bytes);
    row.file = file;
    row.ok = true;
  } catch (e: any) {
    row.ms = Date.now() - started;
    row.error = e?.message ?? String(e);
  }
  return row;
};

const main = async () => {
  const probe = process.argv.includes("--probe");
  const confirm = process.argv.includes("--confirm");

  console.log("PrintPetz — M0 upscale evaluation");
  console.log(`base: ${BASE}`);

  for (const pet of PETS) {
    const p = path.join(BASE, pet, "original.jpg");
    console.log(`  ${fs.existsSync(p) ? "ok    " : "MISSING"} ${pet}`);
  }

  if (!probe && !confirm) {
    const planned = CANDIDATES.reduce((n, c) => n + c.factors.length, 0) * PETS.length;
    console.log(`\nPlan: ${planned} upscale calls (${PETS.length} pets x ${planned / PETS.length} per pet).`);
    console.log("Nothing sent. --probe for one cheap call with measured cost, --confirm for the matrix.");
    return;
  }

  const rows: Row[] = [];

  if (probe) {
    const pet = "Wizard";
    const url = await uploadOriginal(pet);
    console.log(`\nPROBE — ${pet} through esrgan at 2x`);
    const row = await runOne(pet, url, CANDIDATES[0], 2);
    rows.push(row);
    console.log(row.ok
      ? `  SUCCESS ${row.ms}ms  ${row.width}x${row.height}  -> ${row.file}`
      : `  FAILED  ${row.ms}ms  ${row.error}`);
    console.log("\nCheck fal dashboard for the charge, then re-run with --confirm.");
  } else {
    for (const pet of PETS) {
      let url: string;
      try {
        url = await uploadOriginal(pet);
      } catch (e: any) {
        console.log(`  SKIP ${pet}: ${e.message}`);
        continue;
      }
      for (const c of CANDIDATES) {
        for (const factor of c.factors) {
          const row = await runOne(pet, url, c, factor);
          rows.push(row);
          console.log(row.ok
            ? `  ok     ${pet} ${c.name} ${factor}x  ${row.ms}ms  ${row.width}x${row.height}`
            : `  FAILED ${pet} ${c.name} ${factor}x  ${row.error}`);
        }
      }
    }
  }

  fs.writeFileSync(path.join(BASE, "results.json"), JSON.stringify(rows, null, 2));
  const okCount = rows.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${rows.length} succeeded. Budget cap was $${BUDGET_USD}; check the fal dashboard for actual spend.`);
  console.log(`results -> ${path.join(BASE, "results.json")}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
