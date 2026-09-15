/**
 * PrintPetz — FAL vs GPT-Image-2.5 bakeoff.
 *
 * Answers one question: from 3-5 reference photos, is GPT-Image-2.5 as
 * faithful to the pet as FAL is after training?
 *
 * Run it:
 *   npm run build
 *   node -r module-alias/register lib/scripts/provider-bakeoff.js            # plan + cost, runs nothing
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
    species: "unconfirmed",
    note: "George 1.0 - the only one of Darla/Moses/George with pet_name set, so the newest of the three. SPECIES UNCONFIRMED: if George is a cat, this matrix is three cats and one dog. Swap to 13 (Darla 1) or 14 (Moses 1) for a second dog",
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
    if (row.openaiError)
      return `<div class="err">OpenAI failed<br><small>${row.openaiError}</small></div>`;
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
  .err { width: 320px; padding: 24px; background: #fff0f0; color: #a00; border-radius: 6px; }
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
    "openai_error",
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
        r.openaiError,
        r.openaiFile,
      ]
        .map(escape)
        .join(","),
    );
  }
  fs.writeFileSync(path.join(dir, "results.csv"), lines.join("\n"));
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const confirmed = process.argv.includes("--confirm");

  console.log("PrintPetz provider bakeoff — FAL vs GPT-Image-2.5");

  const [pets, styles] = await Promise.all([fetchPets(), fetchStyles()]);

  if (pets.length === 0)
    throw new Error(
      "None of the pinned model ids are usable. See the warnings above.",
    );

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
      row.openaiError =
        error instanceof ImageGenerationFailure
          ? `${error.reason}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      console.log(`      OpenAI failed: ${row.openaiError}`);
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
