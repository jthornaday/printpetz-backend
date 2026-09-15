/**
 * PrintPetz — FAL vs GPT-Image-2.5 bakeoff.
 *
 * Answers one question: from 3-5 reference photos, is GPT-Image-2.5 as
 * faithful to the pet as FAL is after training?
 *
 * Run it:
 *   npm run build
 *   node -r module-alias/register lib/scripts/provider-bakeoff.js --audit-color
 *                                                                          # every model's photos, read only
 *   node -r module-alias/register lib/scripts/provider-bakeoff.js --check-references
 *                                                                          # test the photos, spends nothing
 *   node -r module-alias/register lib/scripts/provider-bakeoff.js            # plan + cost, runs nothing
 *   node -r module-alias/register lib/scripts/provider-bakeoff.js --only=Max/Baseball
 *                                                                          # one cell, request + response printed
 *   node -r module-alias/register lib/scripts/provider-bakeoff.js --confirm  # actually generates
 *
 * It reads models and styles from Supabase and the training photos from S3,
 * and it NEVER writes to the generations table -- results go to
 * scripts/bakeoff/<timestamp>/ as a contact sheet and a CSV. Nothing here
 * charges a customer a credit or appears in anyone's history.
 */
import "module-alias/register";

import dotenv from "dotenv";

dotenv.config({ path: ".env" });

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { generateFalImageSync } from "@/services/fal_service";
import { openAIImageProvider } from "@/services/providers/openai_provider";
import { ImageGenerationFailure } from "@/types/image_provider";
import { IModel } from "@/types/model";
import { generateIdentityPrompt } from "@/utils/fal_utils";
import { getModelTriggerWord } from "@/utils/model_utils";
import { getVariantForImage } from "@/utils/prompt_variants";

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

// Two easy themes as the benchmark, four hard ones as the actual test. Baseball
// is the most-measured theme we have; Founding Father, Warrior and Archery are
// the three that fail on dogs; Superhero carries text on a chest panel.
const THEMES = [
  "Baseball",
  "Santa Claus",
  "Founding Father",
  "Warrior",
  "Archery",
  "Superhero",
];

// Pinned by model id, not by name. models.csv has eleven Wizard trainings,
// seven Maxes, and a row whose pet_name is literally "Wizard Test *". Matching
// on a name would pick one of those at random and quietly measure the wrong
// training -- and "training photos are the biggest per-pet lever" is the whole
// finding from 13 Sept.
//
// Skipped as old dev tests, per Jake: 2 Dog, 3 Jaydeep, 4 Jack's Dog, 6 JP.
type PetPick = {
  modelId: number;
  petName: string;
  species: "cat" | "dog" | "unconfirmed";
  note: string;
};

const PET_PICKS: PetPick[] = [
  {
    modelId: 23,
    petName: "Wizard",
    species: "cat",
    note: "Wizard Test 7 - the training every judged batch used",
  },
  {
    modelId: 27,
    petName: "Max",
    species: "dog",
    note: "Max test 6 - the retrain that is unmistakably Max",
  },
  {
    modelId: 15,
    petName: "Tom",
    species: "cat",
    note: "Tom the Cat - species is in the name. pet_name is null on this row, so the name is set here",
  },
  {
    modelId: 16,
    petName: "George",
    species: "dog",
    note: "George 1.0 - confirmed a dog by Jake, 14 Sept. Second dog in the matrix",
  },
];

const IMAGES_PER_CELL = 2;
const FLARE = "gpt-image-2.5-flare";
const SUNBURST = "gpt-image-2.5-sunburst";
const SUNBURST_THEME = "Baseball";

const LOOK_LEVEL = 1; // Natural, the look every judged batch has used.

// A fixed base seed so the FAL arm is reproducible. The OpenAI arm cannot be:
// the images API has no seed parameter. Worth stating plainly rather than
// implying the two arms are pinned the same way.
const BASE_SEED = 777;

// ---------------------------------------------------------------------------
// Cost model
// ---------------------------------------------------------------------------

// Published rates, USD per 1M tokens.
const RATE_TEXT_INPUT = 5 / 1_000_000;
const RATE_IMAGE_INPUT = 8 / 1_000_000;
const RATE_IMAGE_OUTPUT = 30 / 1_000_000;

// Documented: a 1024x1024 image at quality "high" bills 1760 output tokens.
const EST_OUTPUT_TOKENS = 1760;
// Estimated, not documented: roughly 1.5k tokens per reference photo. This is
// the soft number in the forecast; the CSV reports what the calls actually
// cost, read from each response's usage block.
const EST_TOKENS_PER_REFERENCE = 1500;
const EST_PROMPT_TOKENS = 400;

// fal bills per request, not per token, and does not report a price in the
// response. Override with PRINTPETZ_FAL_COST_PER_IMAGE if the dashboard says
// otherwise -- this is a placeholder for the forecast, not a measurement.
const FAL_COST_PER_IMAGE = Number(
  process.env.PRINTPETZ_FAL_COST_PER_IMAGE ?? 0.035,
);

const estimateOpenAIImageCost = (referenceCount: number) =>
  EST_PROMPT_TOKENS * RATE_TEXT_INPUT +
  referenceCount * EST_TOKENS_PER_REFERENCE * RATE_IMAGE_INPUT +
  EST_OUTPUT_TOKENS * RATE_IMAGE_OUTPUT;

const usd = (n: number) => `$${n.toFixed(2)}`;

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

// Tier 1 is five images a minute. Without pacing, a matrix this size is a wall
// of 429s -- the provider retries them, but slowly and noisily. Pacing up front
// is cheaper than backing off after the fact.
const IMAGES_PER_MINUTE = Number(
  process.env.PRINTPETZ_OPENAI_IMAGES_PER_MINUTE ?? 5,
);
const MIN_GAP_MS = Math.ceil(60_000 / Math.max(IMAGES_PER_MINUTE, 1));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastOpenAICallAt = 0;
const paceOpenAI = async () => {
  const wait = lastOpenAICallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastOpenAICallAt = Date.now();
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type Style = {
  id: number;
  name: string;
  base_prompt: string;
  variants: unknown;
  category: string;
};

type Pet = IModel & { pick: PetPick };

const fetchPets = async (): Promise<Pet[]> => {
  const { data, error } = await supabase
    .from(tables.models)
    .select("*")
    .in(
      "id",
      PET_PICKS.map((pick) => pick.modelId),
    )
    .order("id");

  if (error) throw new Error(`Could not read models: ${error.message}`);

  const byId = new Map(((data ?? []) as IModel[]).map((m) => [m.id, m]));

  return PET_PICKS.map((pick) => {
    const model = byId.get(pick.modelId);
    const skip = (why: string) => {
      console.log(
        `  WARNING: model ${pick.modelId} (${pick.petName}) ${why}, skipped`,
      );
      return undefined;
    };

    if (!model) return skip("was not found");
    if (model.status !== "COMPLETED")
      return skip(`is ${model.status}, not COMPLETED`);
    if (model.is_deleted) return skip("is deleted");
    if (!model.model_path)
      return skip("has no model_path, so the FAL arm cannot run");
    if ((model.training_images ?? []).length === 0) {
      return skip(
        "has no training photos, so the OpenAI arm has nothing to reference",
      );
    }

    // Ids 13-15 predate the pet_name column and would fall back to the model
    // name -- putting "TOM THE CAT" across a baseball cap. The pick decides.
    return { ...model, pet_name: pick.petName, pick };
  }).filter(Boolean) as Pet[];
};

const fetchStyles = async (): Promise<Style[]> => {
  const { data, error } = await supabase
    .from(tables.styles)
    .select("*")
    .in("name", THEMES);

  if (error) throw new Error(`Could not read styles: ${error.message}`);
  return (data ?? []) as Style[];
};

// Mirrors generation_controller.getGenerationSubject. Baseball is built in code
// there and ignores variants, so it is reproduced here rather than reached for.
const buildSubject = (
  style: Style,
  triggerWord: string,
  imageIndex: number,
  petName: string,
) => {
  const normalized = style.name.trim().toLowerCase();

  if (normalized.includes("baseball")) {
    const capName = petName.toUpperCase();
    const isBatting = imageIndex % 2 === 0;
    const stance = isBatting
      ? "baseball batter on hind legs in a clean conventional batter stance"
      : "baseball fielder on hind legs in a clean athletic fielding stance";
    const hands = isBatting
      ? "A leather fielding glove is worn over one forepaw; the other forepaw grips the bat handle."
      : "A leather fielding glove is worn over one forepaw, the other forepaw resting on the glove.";
    return `${triggerWord} as an upright anthropomorphic ${stance}, wearing a plain white baseball jersey, white fabric baseball trousers fully covering the seat, hips and both hind legs down to the ankle, a belt at the waist, and a plain baseball cap whose front panel reads "${capName}" in block letters. Fur shows only on the head, forepaws and tail. ${hands} Epic ballpark background, dramatic lighting, ultra detailed 8K`;
  }

  const subject = style.base_prompt.replaceAll("[TRIGGER_WORD]", triggerWord);
  const variant = getVariantForImage(style.variants, imageIndex, style.name);
  if (!variant) return subject;

  const withStop = subject.trim().replace(/\.?$/, ".");
  return `${withStop} ${variant[0].toUpperCase()}${variant.slice(1)}`;
};

type Cell = {
  petName: string;
  model: IModel;
  style: Style;
  imageIndex: number;
  openaiModel: string;
};

const buildMatrix = (pets: Pet[], styles: Style[]): Cell[] => {
  const cells: Cell[] = [];

  for (const model of pets) {
    const petName = model.pet_name?.trim() || model.name;

    for (const themeName of THEMES) {
      const style = styles.find((s) => s.name === themeName);
      if (!style) continue;

      for (let imageIndex = 0; imageIndex < IMAGES_PER_CELL; imageIndex += 1) {
        cells.push({ petName, model, style, imageIndex, openaiModel: FLARE });
      }
    }

    // One Sunburst image per pet, on the benchmark theme, so the premium tier
    // is visible without paying for it across the whole grid.
    const sunburstStyle = styles.find((s) => s.name === SUNBURST_THEME);
    if (sunburstStyle) {
      cells.push({
        petName,
        model,
        style: sunburstStyle,
        imageIndex: 0,
        openaiModel: SUNBURST,
      });
    }
  }

  return cells;
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

type Row = {
  pet: string;
  theme: string;
  imageIndex: number;
  openaiModel: string;
  falUrl?: string;
  falLatencyMs?: number;
  falError?: string;
  openaiFile?: string;
  openaiLatencyMs?: number;
  openaiCostUsd?: number;
  openaiError?: string;
  openaiErrorDetail?: string;
  openaiStatus?: number;
  seed: number;
  referenceCount: number;
};

const printPlan = (cells: Cell[], pets: Pet[]) => {
  const refCounts = new Map(
    pets.map((p) => [
      p.pet_name?.trim() || p.name,
      Math.min((p.training_images ?? []).length, 5),
    ]),
  );

  console.log("\n=== MATRIX ===\n");
  console.log(`Pets found (${pets.length}):`);
  for (const pet of pets) {
    const name = pet.pet_name?.trim() || pet.name;
    console.log(
      `  ${name.padEnd(10)} model ${String(pet.id).padEnd(4)} ` +
        `${(pet.training_images ?? []).length} training photos ` +
        `-> ${refCounts.get(name)} used as references`,
    );
  }

  const missing = PET_PICKS.filter(
    (pick) => !pets.some((pet) => pet.id === pick.modelId),
  );
  if (missing.length) {
    console.log(
      `  unusable, skipped: ${missing.map((m) => `${m.petName} (id ${m.modelId})`).join(", ")}`,
    );
  }

  const unconfirmed = pets.filter((pet) => pet.pick.species === "unconfirmed");
  for (const pet of unconfirmed) {
    console.log(`\n  CHECK: ${pet.pick.note}`);
  }

  console.log(`\nThemes (${THEMES.length}): ${THEMES.join(", ")}`);
  console.log(
    `Images per cell: ${IMAGES_PER_CELL}  (plus one Sunburst per pet on ${SUNBURST_THEME})`,
  );

  const flareCells = cells.filter((c) => c.openaiModel === FLARE).length;
  const sunburstCells = cells.filter((c) => c.openaiModel === SUNBURST).length;

  console.log("\n=== COST ===\n");
  console.log(`  OpenAI Flare      ${String(flareCells).padStart(3)} images`);
  console.log(
    `  OpenAI Sunburst   ${String(sunburstCells).padStart(3)} images`,
  );
  console.log(
    `  FAL               ${String(cells.length).padStart(3)} images  (LoRA scale from PRINTPETZ_LORA_SCALE)`,
  );

  let openaiCost = 0;
  for (const cell of cells) {
    openaiCost += estimateOpenAIImageCost(refCounts.get(cell.petName) ?? 4);
  }
  const falCost = cells.length * FAL_COST_PER_IMAGE;

  console.log(
    `\n  OpenAI   ~${usd(openaiCost)}   (est: ${EST_OUTPUT_TOKENS} output tokens/image at high, plus references)`,
  );
  console.log(
    `  FAL      ~${usd(falCost)}   (assumes ${usd(FAL_COST_PER_IMAGE)}/image -- a placeholder, check the fal dashboard)`,
  );
  console.log(`  TOTAL    ~${usd(openaiCost + falCost)}\n`);

  const minutes = Math.ceil((cells.length * MIN_GAP_MS) / 60_000);
  console.log(
    `  Wall clock: at least ${minutes} min, paced to ${IMAGES_PER_MINUTE} OpenAI images/min.`,
  );
  console.log(
    `  Raise PRINTPETZ_OPENAI_IMAGES_PER_MINUTE once the org is above tier 1.\n`,
  );

  console.log(
    "  The OpenAI arm is NOT seed-pinned: the images API has no seed",
  );
  console.log("  parameter. Only the FAL arm is reproducible.\n");
};

const writeContactSheet = (dir: string, rows: Row[]) => {
  const cell = (row: Row, side: "fal" | "openai") => {
    if (side === "fal") {
      if (row.falError)
        return `<div class="err">FAL failed<br><small>${row.falError}</small></div>`;
      return `<img src="${row.falUrl}" loading="lazy" alt="FAL ${row.pet} ${row.theme}">`;
    }
    if (row.openaiError) {
      const detail = row.openaiErrorDetail
        ? `<pre>${row.openaiErrorDetail.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>`
        : "";
      return `<div class="err"><strong>OpenAI failed</strong><br><small>${row.openaiError}</small>${detail}</div>`;
    }
    return `<img src="${row.openaiFile}" loading="lazy" alt="OpenAI ${row.pet} ${row.theme}">`;
  };

  const scoreBoxes = ["identity", "anatomy", "wardrobe", "name"]
    .map((c) => `<label><input type="checkbox"> ${c}</label>`)
    .join(" ");

  const body = rows
    .map(
      (row) => `
    <tr>
      <th>${row.pet}<br><span>${row.theme}</span><br><small>#${row.imageIndex} · seed ${row.seed}</small></th>
      <td>${cell(row, "fal")}<div class="meta">${row.falLatencyMs ?? "-"} ms</div></td>
      <td>${cell(row, "openai")}<div class="meta">${row.openaiModel.replace("gpt-image-2.5-", "")} · ${row.openaiLatencyMs ?? "-"} ms · ${row.openaiCostUsd !== undefined ? "$" + row.openaiCostUsd.toFixed(4) : "-"}</div></td>
      <td class="score">${scoreBoxes}</td>
    </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<meta charset="utf-8">
<title>PrintPetz provider bakeoff</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 24px; background: #f8f7fb; color: #171524; }
  h1 { font-size: 20px; }
  p.note { color: #555; max-width: 70ch; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e0dce8; padding: 8px; vertical-align: top; }
  thead th { position: sticky; top: 0; background: #fff; z-index: 1; }
  th { text-align: left; font-weight: 700; width: 130px; }
  th span { font-weight: 400; color: #555; }
  th small, .meta { color: #777; font-size: 11px; font-weight: 400; }
  img { width: 320px; max-width: 100%; display: block; border-radius: 6px; }
  .err { width: 320px; padding: 16px; background: #fff0f0; color: #a00; border-radius: 6px; }
  .err pre { white-space: pre-wrap; word-break: break-word; font-size: 10px; margin: 8px 0 0; color: #700; max-height: 240px; overflow: auto; }
  .score label { display: block; white-space: nowrap; font-size: 12px; }
  td.score { width: 120px; }
</style>
<h1>FAL vs GPT-Image-2.5 — ${rows.length} pairs</h1>
<p class="note">
  Left is FAL at the current <code>PRINTPETZ_LORA_SCALE</code>, seed-pinned. Right is OpenAI,
  which has no seed parameter and so cannot be pinned. Score each pair on identity
  (is it THIS pet), anatomy (paws not hands, right number of legs, no floating props),
  wardrobe, and name spelling. The checkboxes are scratch space — the real scorecard
  is the CSV beside this file.
</p>
<table>
  <thead><tr><th>Pet / theme</th><th>FAL</th><th>OpenAI</th><th>Score</th></tr></thead>
  <tbody>${body}</tbody>
</table>`;

  fs.writeFileSync(path.join(dir, "contact-sheet.html"), html);
};

const writeCsv = (dir: string, rows: Row[]) => {
  const header = [
    "pet",
    "theme",
    "image_index",
    "seed",
    "reference_count",
    "openai_model",
    "fal_latency_ms",
    "fal_error",
    "fal_url",
    "openai_latency_ms",
    "openai_cost_usd",
    "openai_status",
    "openai_error",
    "openai_error_detail",
    "openai_file",
  ];
  const escape = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.pet,
        r.theme,
        r.imageIndex,
        r.seed,
        r.referenceCount,
        r.openaiModel,
        r.falLatencyMs,
        r.falError,
        r.falUrl,
        r.openaiLatencyMs,
        r.openaiCostUsd?.toFixed(6),
        r.openaiStatus,
        r.openaiError,
        r.openaiErrorDetail,
        r.openaiFile,
      ]
        .map(escape)
        .join(","),
    );
  }
  fs.writeFileSync(path.join(dir, "results.csv"), lines.join("\n"));
};


// ---------------------------------------------------------------------------
// Reference preflight
// ---------------------------------------------------------------------------

// What OpenAI's images endpoint will accept. Anything else is a 400 before a
// single token is spent.
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;

/**
 * What the bytes actually are, regardless of what the URL or the Content-Type
 * claims. An iPhone photo saved as ".jpg" is very often still HEIC inside, and
 * that is invisible until something tries to decode it.
 */
const sniffFormat = (bytes: Buffer): string => {
  if (bytes.length < 12) return "too short to identify";
  if (bytes[0] === 0x89 && bytes.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.toString("latin1", 0, 4) === "GIF8") return "image/gif";

  // ISO base media container: the brand at offset 8 says which flavour.
  if (bytes.toString("latin1", 4, 8) === "ftyp") {
    const brand = bytes.toString("latin1", 8, 12);
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return `image/heic (brand ${brand})`;
    if (brand === "avif") return "image/avif";
    return `iso container, brand ${brand}`;
  }

  return `unrecognised (starts ${bytes.toString("hex", 0, 8)})`;
};

/** Width and height straight out of the file header. No dependency, because a
 * diagnostic that needs an npm install is a diagnostic nobody runs. */
const readDimensions = (bytes: Buffer): string => {
  try {
    if (bytes.toString("latin1", 1, 4) === "PNG") {
      return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
    }
    if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
      const chunk = bytes.toString("latin1", 12, 16);
      if (chunk === "VP8X") return `${(bytes.readUIntLE(24, 3) & 0xffffff) + 1}x${(bytes.readUIntLE(27, 3) & 0xffffff) + 1}`;
      if (chunk === "VP8 ") return `${bytes.readUInt16LE(26) & 0x3fff}x${bytes.readUInt16LE(28) & 0x3fff}`;
      return "webp, variant not parsed";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      // Walk the JPEG segments to the start-of-frame, which carries the size.
      let offset = 2;
      while (offset < bytes.length - 9) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        // SOF0-SOF15, skipping the four that are not frame headers.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return `${bytes.readUInt16BE(offset + 7)}x${bytes.readUInt16BE(offset + 5)}`;
        }
        offset += 2 + bytes.readUInt16BE(offset + 2);
      }
      return "jpeg, no SOF found";
    }
  } catch {
    return "unreadable";
  }
  return "unknown";
};

const checkReferences = async (pets: Pet[]) => {
  console.log("\n=== REFERENCE PREFLIGHT ===");
  console.log("Fetching every training photo. No OpenAI calls, nothing spent.\n");

  let problems = 0;

  for (const pet of pets) {
    const urls = (pet.training_images ?? []).slice(0, 5);
    console.log(`${pet.pet_name} (model ${pet.id}) — ${urls.length} reference(s) of ${(pet.training_images ?? []).length} total`);

    for (const url of urls) {
      let verdict: string;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          verdict = `FAIL  HTTP ${response.status} — OpenAI cannot fetch this either`;
          problems += 1;
        } else {
          const declared = response.headers.get("content-type") ?? "(none)";
          const bytes = Buffer.from(await response.arrayBuffer());
          const actual = sniffFormat(bytes);
          const sizeMb = (bytes.length / 1024 / 1024).toFixed(2);

          const accepted = ACCEPTED_TYPES.has(actual);
          const tooBig = bytes.length > MAX_REFERENCE_BYTES;
          const servedAs = declared.split(";")[0].trim();
          const dimensions = readDimensions(bytes);

          // OpenAI fetches this URL itself and sees only the Content-Type
          // header. Valid JPEG bytes served as application/octet-stream are
          // still a 400 to it, because it never gets as far as the bytes.
          // An earlier version of this check called that "harmless". It is
          // not, and saying so sent the last diagnosis down the wrong path.
          const servedAsImage = ACCEPTED_TYPES.has(servedAs);

          if (!accepted) {
            verdict = `FAIL  actual bytes are ${actual} — not PNG, JPEG or WebP`;
            problems += 1;
          } else if (!servedAsImage) {
            verdict =
              `FAIL  bytes are a valid ${actual}, but the server declares ` +
              `Content-Type: ${servedAs} — OpenAI reads the header, not the bytes`;
            problems += 1;
          } else if (tooBig) {
            verdict = `FAIL  ${sizeMb}MB exceeds the 50MB limit`;
            problems += 1;
          } else {
            verdict = `ok    ${actual}, ${dimensions}, ${sizeMb}MB`;
          }
        }
      } catch (error) {
        verdict = `FAIL  unfetchable: ${error instanceof Error ? error.message : String(error)}`;
        problems += 1;
      }

      const shortUrl = url.length > 76 ? `${url.slice(0, 40)}...${url.slice(-33)}` : url;
      console.log(`  ${verdict}`);
      console.log(`        ${shortUrl}`);
    }
    console.log("");
  }

  if (problems === 0) {
    console.log("Every reference is fetchable and in an accepted format.");
    console.log("If OpenAI still 400s, the cause is the prompt, not the photos —");
    console.log("rerun the bakeoff and read openai_error_detail in the CSV.\n");
  } else {
    console.log(`${problems} reference(s) OpenAI will reject. Those pets cannot run until the`);
    console.log("photos are converted or re-uploaded. No point rerunning the bakeoff first.\n");
  }
};

// ---------------------------------------------------------------------------
// Colour-profile audit
// ---------------------------------------------------------------------------

// Pull the embedded ICC profile out of a JPEG. It can be split across several
// APP2 segments, so they are collected in sequence order and concatenated.
const jpegIccProfile = (bytes: Buffer): Buffer | null => {
  const chunks: Array<{ seq: number; data: Buffer }> = [];
  let offset = 2;
  while (offset < bytes.length - 4) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan, end of image
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe2 && bytes.toString("latin1", offset + 4, offset + 15) === "ICC_PROFILE") {
      chunks.push({ seq: bytes[offset + 16], data: bytes.subarray(offset + 18, offset + 2 + length) });
    }
    offset += 2 + length;
  }
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  return Buffer.concat(chunks.map((c) => c.data));
};

/**
 * The profile's human-readable name, from its 'desc' tag.
 *
 * ICC v4 stores it as 'mluc', whose strings are UTF-16BE. Node only decodes
 * LE, hence the byte swap. The record layout is count/size at 8/12, then
 * language 16, country 18, LENGTH 20, OFFSET 24 -- getting those last two
 * wrong reads past the string and returns mojibake that still starts with the
 * right words, which is exactly the sort of bug that survives a spot check.
 */
const iccDescription = (profile: Buffer): string | null => {
  if (profile.length < 132) return null;
  const tagCount = profile.readUInt32BE(128);

  for (let i = 0; i < tagCount; i += 1) {
    const entry = 132 + i * 12;
    if (entry + 12 > profile.length) break;
    if (profile.toString("latin1", entry, entry + 4) !== "desc") continue;

    const at = profile.readUInt32BE(entry + 4);
    if (at + 28 > profile.length) return null;
    const type = profile.toString("latin1", at, at + 4);

    if (type === "desc") {
      const n = profile.readUInt32BE(at + 8);
      return profile.toString("latin1", at + 12, at + 12 + n).replace(/\0.*$/, "").trim() || null;
    }
    if (type === "mluc") {
      const len = profile.readUInt32BE(at + 20);
      const strAt = profile.readUInt32BE(at + 24);
      if (at + strAt + len > profile.length) return null;
      const raw = Buffer.from(profile.subarray(at + strAt, at + strAt + len));
      raw.swap16();
      return raw.toString("utf16le").replace(/\0/g, "").trim() || null;
    }
  }
  return null;
};

const pngProfileName = (bytes: Buffer): string | null => {
  let offset = 8;
  let sawSrgbChunk = false;
  while (offset + 8 < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (type === "sRGB") sawSrgbChunk = true;
    if (type === "iCCP") {
      const body = bytes.subarray(offset + 8, offset + 8 + length);
      const nul = body.indexOf(0);
      const name = body.toString("latin1", 0, nul);
      try {
        return iccDescription(zlib.inflateSync(body.subarray(nul + 2))) || name;
      } catch {
        return name;
      }
    }
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }
  return sawSrgbChunk ? "sRGB" : null;
};

const readColorProfile = (bytes: Buffer): string | null => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const profile = jpegIccProfile(bytes);
    return profile ? iccDescription(profile) : null;
  }
  if (bytes.toString("latin1", 1, 4) === "PNG") return pngProfileName(bytes);
  return null;
};

type Verdict = "heic" | "other-format" | "non-srgb" | "srgb" | "no-profile" | "unfetchable";

/**
 * Verdicts are grounded in the bakeoff, not in theory:
 *   Max     -- all four JPEGs carry an Apple "Display P3" profile, 0/13 passed.
 *   Wizard  -- all five JPEGs carry NO profile at all, 13/13 passed.
 * So an absent profile is fine and an explicit wide-gamut one is fatal. Note
 * that `sips -g profile` reports "sRGB IEC61966-2.1" for Wizard's files even
 * though they have no embedded profile -- it reports the assumed space, not
 * what is in the file. That conflation would have put every Wizard photo in
 * the wrong bucket here.
 */
const classify = (format: string, profile: string | null): Verdict => {
  if (format.startsWith("image/heic")) return "heic";
  if (!["image/png", "image/jpeg", "image/webp"].includes(format)) return "other-format";
  if (!profile) return "no-profile";
  return /s\s*rgb/i.test(profile) ? "srgb" : "non-srgb";
};

const auditColorProfiles = async () => {
  const { data, error } = await supabase
    .from(tables.models)
    .select("id,name,pet_name,status,is_deleted,training_images")
    .order("id");

  if (error) throw new Error(`Could not read models: ${error.message}`);

  const models = (data ?? []) as Array<{
    id: number;
    name: string;
    pet_name: string | null;
    status: string;
    is_deleted: boolean;
    training_images: string[] | null;
  }>;

  console.log("\n=== COLOUR PROFILE AUDIT ===");
  console.log("Read only. Every photo is fetched into memory and inspected.");
  console.log("No file, S3 object or database row is written.\n");

  const totals: Record<Verdict, number> = {
    heic: 0, "other-format": 0, "non-srgb": 0, srgb: 0, "no-profile": 0, unfetchable: 0,
  };
  const profileNames = new Map<string, number>();
  const perModel: string[] = [];
  let checked = 0;

  for (const model of models) {
    const urls = model.training_images ?? [];
    if (urls.length === 0) continue;

    const counts: Record<Verdict, number> = {
      heic: 0, "other-format": 0, "non-srgb": 0, srgb: 0, "no-profile": 0, unfetchable: 0,
    };
    const names = new Set<string>();

    // Six at a time: enough to keep this to a couple of minutes, few enough
    // not to look like an attack on our own CDN.
    for (let i = 0; i < urls.length; i += 6) {
      await Promise.all(
        urls.slice(i, i + 6).map(async (url) => {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              counts.unfetchable += 1;
              return;
            }
            const bytes = Buffer.from(await response.arrayBuffer());
            const format = sniffFormat(bytes);
            const profile = readColorProfile(bytes);
            const verdict = classify(format, profile);
            counts[verdict] += 1;
            if (verdict === "non-srgb" && profile) {
              names.add(profile);
              profileNames.set(profile, (profileNames.get(profile) ?? 0) + 1);
            }
          } catch {
            counts.unfetchable += 1;
          }
        }),
      );
    }

    checked += urls.length;
    for (const key of Object.keys(counts) as Verdict[]) totals[key] += counts[key];

    const broken = counts.heic + counts["non-srgb"] + counts["other-format"] + counts.unfetchable;
    const label = `${model.pet_name?.trim() || model.name} (id ${model.id})`;
    const flag = broken > 0 ? "BROKEN" : "ok    ";
    const detail = [
      counts.heic ? `${counts.heic} HEIC` : "",
      counts["non-srgb"] ? `${counts["non-srgb"]} non-sRGB${names.size ? ` [${[...names].join(", ")}]` : ""}` : "",
      counts["other-format"] ? `${counts["other-format"]} other-format` : "",
      counts.unfetchable ? `${counts.unfetchable} unfetchable` : "",
      counts.srgb ? `${counts.srgb} sRGB` : "",
      counts["no-profile"] ? `${counts["no-profile"]} no-profile` : "",
    ].filter(Boolean).join(", ");

    const line = `  ${flag} ${label.padEnd(28)} ${String(urls.length).padStart(3)} photo(s)  ${detail}`;
    perModel.push(line);
    console.log(line + (model.is_deleted ? "  [deleted]" : "") + (model.status !== "COMPLETED" ? `  [${model.status}]` : ""));
  }

  const usable = totals.srgb + totals["no-profile"];
  const rejected = totals.heic + totals["non-srgb"] + totals["other-format"];

  console.log("\n=== TOTALS ===\n");
  console.log(`  models with photos        ${perModel.length}`);
  console.log(`  training photos checked   ${checked}`);
  console.log("");
  console.log(`  OpenAI would accept       ${usable}`);
  console.log(`    sRGB profile            ${totals.srgb}`);
  console.log(`    no embedded profile     ${totals["no-profile"]}   (Wizard's case -- passed 13/13)`);
  console.log("");
  console.log(`  OpenAI would reject       ${rejected}`);
  console.log(`    HEIC                    ${totals.heic}`);
  console.log(`    non-sRGB profile        ${totals["non-srgb"]}   (Max's case -- failed 13/13)`);
  console.log(`    other format            ${totals["other-format"]}`);
  console.log(`  unfetchable               ${totals.unfetchable}`);

  if (profileNames.size) {
    console.log("\n  non-sRGB profiles seen:");
    for (const [name, n] of [...profileNames].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${name}`);
    }
  }

  const brokenModels = perModel.filter((l) => l.includes("BROKEN")).length;
  console.log(`\n  models with at least one unusable photo: ${brokenModels} of ${perModel.length}`);
  console.log("\n  A model is unusable on OpenAI if ANY of its references is bad:");
  console.log("  they all go in one request, so one photo fails every theme.\n");
};

// ---------------------------------------------------------------------------
// Single-cell debug
// ---------------------------------------------------------------------------

/**
 * One OpenAI call, every request parameter printed, the whole response body
 * printed. For when 52 rows of "400" have told you nothing and you want to see
 * exactly what went over the wire.
 *
 * Costs one image. Requires --confirm as well, so it cannot fire by accident.
 */
const debugOneCell = async (pets: Pet[], styles: Style[], target: string) => {
  const [petName, themeName] = target.split("/");
  const pet = pets.find(
    (p) => (p.pet_name ?? "").toLowerCase() === (petName ?? "").toLowerCase(),
  );
  const style = styles.find(
    (st) => st.name.toLowerCase() === (themeName ?? "").toLowerCase(),
  );

  if (!pet) throw new Error(`No pet named "${petName}". Try: ${pets.map((p) => p.pet_name).join(", ")}`);
  if (!style) throw new Error(`No theme named "${themeName}". Try: ${THEMES.join(", ")}`);

  const references = (pet.training_images ?? []).slice(0, 5);
  const prompt = generateIdentityPrompt(
    buildSubject(style, "the pet", 0, pet.pet_name as string),
    LOOK_LEVEL,
    pet.pet_name as string,
    style.name,
    pet.pet_description?.trim() || undefined,
    "reference",
  );

  const model = process.env.PRINTPETZ_OPENAI_MODEL?.trim() || FLARE;
  const size = process.env.PRINTPETZ_OPENAI_SIZE?.trim() || "832x1024";
  const quality = process.env.PRINTPETZ_OPENAI_QUALITY?.trim() || "high";

  console.log("\n=== REQUEST ===\n");
  console.log(`  pet              ${pet.pet_name} (model ${pet.id})`);
  console.log(`  theme            ${style.name}`);
  console.log(`  model            "${model}"`);
  console.log(`  size             "${size}"`);
  console.log(`  quality          "${quality}"`);
  console.log(`  n                1`);
  console.log(`  output_format    "jpeg"`);
  console.log(`  prompt           ${prompt.length} chars`);
  console.log(`  references       ${references.length} of ${(pet.training_images ?? []).length}\n`);

  for (const url of references) {
    try {
      const response = await fetch(url);
      const declared = response.headers.get("content-type") ?? "(none)";
      const bytes = Buffer.from(await response.arrayBuffer());
      console.log(`    HTTP ${response.status}  served-as ${declared}  actual ${sniffFormat(bytes)}  ${readDimensions(bytes)}  ${(bytes.length / 1024).toFixed(0)}kB`);
    } catch (error) {
      console.log(`    UNFETCHABLE  ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`      ${url}`);
  }

  console.log("\n  --- prompt as sent ---");
  console.log(`  ${prompt}\n`);

  if (!process.argv.includes("--confirm")) {
    console.log("=== NOT SENT ===\n");
    console.log("Nothing was sent to OpenAI. Add --confirm to fire this one call.\n");
    return;
  }

  console.log("=== SENDING ===\n");

  try {
    const result = await openAIImageProvider.generate({
      prompt,
      modelPath: pet.model_path,
      referenceImageUrls: references,
      petName: pet.pet_name as string,
      seed: BASE_SEED,
      styleName: style.name,
    });

    if (result.kind !== "complete") throw new Error("queued result from a synchronous provider");

    const out = path.join(process.cwd(), `debug-${pet.pet_name}-${style.name.replace(/\W+/g, "-")}.jpg`);
    fs.writeFileSync(out, result.image.buffer);
    console.log(`  SUCCESS  ${result.providerMeta.latencyMs}ms  $${(result.providerMeta.costUsd ?? 0).toFixed(4)}`);
    console.log(`  usage    ${JSON.stringify(result.providerMeta.usage)}`);
    console.log(`  written  ${out}\n`);
  } catch (error) {
    if (error instanceof ImageGenerationFailure) {
      console.log(`  FAILED   HTTP ${error.status ?? "?"} after ${error.elapsedMs ?? "?"}ms`);
      console.log(`  reason   ${error.reason}`);
      console.log(`  message  ${error.message}`);
      console.log("\n  --- response body, verbatim ---");
      console.log(error.detail ?? "  (the provider captured no body)");
      console.log("");
    } else {
      console.log(`  FAILED   ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const confirmed = process.argv.includes("--confirm");

  console.log("PrintPetz provider bakeoff — FAL vs GPT-Image-2.5");

  const checkingReferences = process.argv.includes("--check-references");
  const auditingColor = process.argv.includes("--audit-color");
  const onlyFlag = process.argv.find((arg) => arg.startsWith("--only="));

  // The audit covers every model in the table, not the four pinned picks, so
  // it runs before pet resolution and returns without touching anything else.
  if (auditingColor) {
    await auditColorProfiles();
    return;
  }

  // The reference check is about photos, not themes. Fetching styles it will
  // never read would let an unrelated styles problem block a photo diagnosis.
  const [pets, styles] = await Promise.all([
    fetchPets(),
    checkingReferences ? Promise.resolve([] as Style[]) : fetchStyles(),
  ]);

  if (pets.length === 0)
    throw new Error(
      "None of the pinned model ids are usable. See the warnings above.",
    );

  if (checkingReferences) {
    await checkReferences(pets);
    return;
  }

  if (onlyFlag) {
    await debugOneCell(pets, styles, onlyFlag.slice("--only=".length));
    return;
  }

  const foundThemes = styles.map((s) => s.name);
  const missingThemes = THEMES.filter((t) => !foundThemes.includes(t));
  if (missingThemes.length) {
    console.log(
      `\n  WARNING: themes not found in styles, skipped: ${missingThemes.join(", ")}`,
    );
  }

  const cells = buildMatrix(pets, styles);
  printPlan(cells, pets);

  if (!confirmed) {
    console.log(
      "Nothing has been generated. Re-run with --confirm to spend the above.\n",
    );
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Set it before running with --confirm.",
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "scripts", "bakeoff", stamp);
  const imageDir = path.join(outDir, "openai");
  fs.mkdirSync(imageDir, { recursive: true });

  const rows: Row[] = [];

  for (const [index, cell] of cells.entries()) {
    const petName = cell.petName;
    const references = (cell.model.training_images ?? []).slice(0, 5);
    const seed = (BASE_SEED + cell.imageIndex) % 4294967296;

    const row: Row = {
      pet: petName,
      theme: cell.style.name,
      imageIndex: cell.imageIndex,
      openaiModel: cell.openaiModel,
      seed,
      referenceCount: references.length,
    };

    console.log(
      `[${index + 1}/${cells.length}] ${petName} · ${cell.style.name} #${cell.imageIndex} · ${cell.openaiModel.replace("gpt-image-2.5-", "")}`,
    );

    // --- FAL arm: the trained LoRA, trigger word and all.
    try {
      const falPrompt = generateIdentityPrompt(
        buildSubject(
          cell.style,
          getModelTriggerWord(cell.model.model_path, cell.model.name),
          cell.imageIndex,
          petName,
        ),
        LOOK_LEVEL,
        petName,
        cell.style.name,
        cell.model.pet_description?.trim() || undefined,
        "lora",
      );
      const fal = await generateFalImageSync(
        falPrompt,
        cell.model.model_path,
        seed,
        cell.style.name,
      );
      row.falUrl = fal.url;
      row.falLatencyMs = fal.latencyMs;
    } catch (error) {
      row.falError = error instanceof Error ? error.message : String(error);
      console.log(`      FAL failed: ${row.falError}`);
    }

    // --- OpenAI arm: reference photos, no trigger word.
    try {
      await paceOpenAI();
      process.env.PRINTPETZ_OPENAI_MODEL = cell.openaiModel;

      const openaiPrompt = generateIdentityPrompt(
        buildSubject(cell.style, "the pet", cell.imageIndex, petName),
        LOOK_LEVEL,
        petName,
        cell.style.name,
        cell.model.pet_description?.trim() || undefined,
        "reference",
      );

      const result = await openAIImageProvider.generate({
        prompt: openaiPrompt,
        modelPath: cell.model.model_path,
        referenceImageUrls: references,
        petName,
        seed,
        styleName: cell.style.name,
      });

      if (result.kind !== "complete")
        throw new Error("OpenAI returned a queued result");

      const fileName = `${petName}_${cell.style.name.replace(/\W+/g, "-")}_${cell.imageIndex}_${cell.openaiModel.replace("gpt-image-2.5-", "")}.jpg`;
      fs.writeFileSync(path.join(imageDir, fileName), result.image.buffer);
      row.openaiFile = `openai/${fileName}`;
      row.openaiLatencyMs = result.providerMeta.latencyMs;
      row.openaiCostUsd = result.providerMeta.costUsd;
    } catch (error) {
      if (error instanceof ImageGenerationFailure) {
        row.openaiError = `${error.reason}: ${error.message}`;
        // The body is the whole diagnosis. "OpenAI returned 400" says nothing;
        // the body names the image it could not read or the term it objected
        // to. Dropping it was what made the first run unreadable.
        row.openaiErrorDetail = error.detail;
        row.openaiStatus = error.status;
        row.openaiLatencyMs = error.elapsedMs;
      } else {
        row.openaiError = error instanceof Error ? error.message : String(error);
      }
      console.log(`      OpenAI failed: ${row.openaiError}`);
      if (row.openaiErrorDetail) {
        console.log(`        body: ${row.openaiErrorDetail.slice(0, 400)}`);
      }
    }

    rows.push(row);
    // Written every iteration so a run killed halfway still leaves a readable
    // sheet of everything it did manage.
    writeContactSheet(outDir, rows);
    writeCsv(outDir, rows);
  }

  const actualCost = rows.reduce((sum, r) => sum + (r.openaiCostUsd ?? 0), 0);
  const failures = rows.filter((r) => r.openaiError).length;

  console.log(`\nDone. ${rows.length} pairs, ${failures} OpenAI failures.`);
  console.log(`Actual OpenAI spend, from the usage blocks: ${usd(actualCost)}`);
  console.log(`\n  ${path.join(outDir, "contact-sheet.html")}`);
  console.log(`  ${path.join(outDir, "results.csv")}\n`);
};

main().catch((error) => {
  console.error(
    "\nBakeoff failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
