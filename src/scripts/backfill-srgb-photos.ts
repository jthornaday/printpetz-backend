/**
 * PrintPetz — backfill the training photos that predate the upload-time fix.
 *
 * Milestone 2 of specs/srgb-conversion.md. PR #36 stops new bad photos
 * arriving; this repairs the ones already in the table.
 *
 * Run it:
 *   npm run build
 *   node -r module-alias/register lib/scripts/backfill-srgb-photos.js            # dry run
 *   node -r module-alias/register lib/scripts/backfill-srgb-photos.js --confirm  # writes to S3
 *   node -r module-alias/register lib/scripts/backfill-srgb-photos.js --fix-orientation
 *                                                     # second pass: bake EXIF orientation, same keys
 *
 * It NEVER writes to the database and NEVER overwrites or deletes an original
 * S3 object. Converted photos go to new keys; the SQL that repoints
 * models.training_images is written to a file for Jake to review and run.
 */
import "module-alias/register";

import dotenv from "dotenv";

dotenv.config({ path: ".env" });

// Checked here, between the imports, because the Supabase client is built at
// import time -- a missing variable otherwise surfaces as a raw stack trace
// from inside node_modules rather than something actionable. TypeScript keeps
// statement order for CommonJS, so this runs before the client is required.
for (const required of ["SUPABASE_URL", "SUPABASE_KEY"]) {
  const value = process.env[required]?.trim();
  if (!value || value.startsWith("<")) {
    // eslint-disable-next-line no-console
    console.error(
      `\n${required} is ${!value ? "not set" : "still a placeholder"}.\n\n` +
        "Run it like this, substituting your own values:\n\n" +
        "  export SUPABASE_URL=...\n" +
        "  export SUPABASE_KEY=...\n" +
        "  node -r module-alias/register lib/scripts/backfill-srgb-photos.js\n",
    );
    process.exit(1);
  }
}

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import AppConstants from "@/constants/app_constants";
import { uploadFileToS3 } from "@/services/aws_service";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IModel } from "@/types/model";
import {
  convertToSrgbJpeg,
  isSrgb,
  readColorProfile,
  sniffFormat,
} from "@/utils/image_conversion";

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

type Target = {
  modelId: number;
  petName: string;
  /** "verify" touches nothing at all -- no download decisions, no S3, no SQL. */
  mode: "convert" | "verify";
  note: string;
};

// Pinned by id. The table holds eleven Wizard trainings and seven Maxes, so
// matching on a name would repair the wrong one.
const TARGETS: Target[] = [
  { modelId: 15, petName: "Tom", mode: "convert", note: "3 x HEIC" },
  { modelId: 16, petName: "George", mode: "convert", note: "3 x HEIC" },
  {
    modelId: 23,
    petName: "Wizard",
    mode: "verify",
    note: "already clean -- confirm only",
  },
  { modelId: 27, petName: "Max", mode: "convert", note: "4 x Display P3" },
];

const SQL_OUTPUT = path.join(
  process.cwd(),
  "update-models-training-images-srgb.sql",
);

const SRGB_PROFILE = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";
const SIPS_QUALITY = "92";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const confirmed = process.argv.includes("--confirm");

const keyFromUrl = (url: string) => new URL(url).pathname.replace(/^\//, "");

// foo.HEIC -> foo-srgb.jpg. The pairing stays obvious in a bucket listing, and
// the extension stops lying about what the bytes are.
const srgbKeyFor = (key: string) => `${key.replace(/\.[^./]+$/, "")}-srgb.jpg`;

const sqlQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * models.training_images is a Postgres text[], NOT jsonb.
 *
 * An earlier version of this emitted `'[...]'::jsonb` and Postgres refused it
 * outright: `column "training_images" is of type text[] but expression is of
 * type jsonb`. Nothing was written, so the failure was loud and harmless -- but
 * it is worth being explicit, because `string[]` in TypeScript and a JSON array
 * in the API response both read like jsonb and neither tells you the column
 * type.
 *
 * ARRAY[...] rather than the '{"a","b"}' literal form: the values are URLs and
 * the ARRAY constructor takes ordinary quoted strings, so the escaping is the
 * same single-quote doubling used everywhere else here. The curly-brace form
 * needs its own backslash and double-quote rules on top.
 */
const sqlTextArray = (values: string[]) =>
  values.length === 0
    ? "ARRAY[]::text[]"
    : `ARRAY[\n    ${values.map(sqlQuote).join(",\n    ")}\n  ]::text[]`;

/**
 * HEIC, via macOS. sharp's libheif parses the container but cannot decode the
 * pixels. These backfills were validated against ColorSync, so they keep using
 * sips rather than the heic-convert path the upload handler now uses.
 */
const convertHeicWithSips = async (
  bytes: Buffer,
  filename: string,
): Promise<Buffer> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "printpetz-heic-"));
  const input = path.join(dir, filename.replace(/[^\w.-]/g, "_"));
  const output = path.join(dir, "out.jpg");

  try {
    fs.writeFileSync(input, bytes);
    execFileSync(
      "sips",
      [
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        SIPS_QUALITY,
        "--matchTo",
        SRGB_PROFILE,
        input,
        "--out",
        output,
      ],
      { stdio: "pipe" },
    );

    // sips leaves the EXIF orientation tag in place rather than applying it, so
    // four of these six files come out with orientation=6 -- upright only if
    // whatever reads them honours the tag. convertToSrgbJpeg bakes orientation
    // into the pixels via .rotate(), so Max's photos are upright regardless.
    // Matching that here removes an asymmetry between pets in the very
    // comparison this backfill exists to make fair: a sideways reference would
    // degrade identity without failing any check here, and would be near
    // impossible to attribute afterwards.
    return sharp(fs.readFileSync(output))
      .rotate()
      .jpeg({ quality: Number(SIPS_QUALITY) })
      .toBuffer();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

type PhotoPlan = {
  index: number;
  originalUrl: string;
  originalKey: string;
  filename: string;
  format: string;
  profile: string | null;
  /** null when the photo is already acceptable and keeps its original URL. */
  newKey: string | null;
  reason: string;
  converted?: Buffer;
};

const classify = (bytes: Buffer) => {
  const format = sniffFormat(bytes);
  const profile = format === "image/heic" ? null : readColorProfile(bytes);
  const acceptable =
    ["image/png", "image/jpeg", "image/webp"].includes(format) &&
    isSrgb(profile);
  return { format, profile, acceptable };
};

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

const planForModel = async (
  target: Target,
  model: IModel,
): Promise<PhotoPlan[]> => {
  const urls = model.training_images ?? [];
  const plans: PhotoPlan[] = [];

  for (const [index, originalUrl] of urls.entries()) {
    const response = await fetch(originalUrl);
    if (!response.ok) {
      plans.push({
        index,
        originalUrl,
        originalKey: keyFromUrl(originalUrl),
        filename: path.basename(keyFromUrl(originalUrl)),
        format: "unfetchable",
        profile: null,
        newKey: null,
        reason: `UNFETCHABLE (HTTP ${response.status})`,
      });
      continue;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const { format, profile, acceptable } = classify(bytes);
    const originalKey = keyFromUrl(originalUrl);
    const filename = path.basename(originalKey);

    if (acceptable) {
      plans.push({
        index,
        originalUrl,
        originalKey,
        filename,
        format,
        profile,
        newKey: null,
        reason: `already fine (${format}${profile ? `, ${profile}` : ", no profile"})`,
      });
      continue;
    }

    let converted: Buffer;
    if (format === "image/heic") {
      converted = await convertHeicWithSips(bytes, filename);
    } else {
      // The same call the upload path makes, so a backfilled photo and a newly
      // uploaded one go through identical code.
      converted = (await convertToSrgbJpeg(bytes, filename)).buffer;
    }

    plans.push({
      index,
      originalUrl,
      originalKey,
      filename,
      format,
      profile,
      newKey: srgbKeyFor(originalKey),
      reason: `${format}${profile ? `, ${profile}` : ""} -> sRGB JPEG`,
      converted,
    });
  }

  return plans;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Orientation repair
// ---------------------------------------------------------------------------

/**
 * A targeted second pass for photos already converted and already pointed at
 * by the database.
 *
 * The normal path cannot touch these. classify() calls them acceptable -- they
 * ARE valid sRGB JPEGs -- so planForModel skips them and the script correctly
 * reports nothing to do. What it cannot see is EXIF orientation: sips converted
 * the colour but left orientation=6 on four of the six HEIC conversions, so
 * those files are upright only for a reader that honours the tag.
 *
 * Keys do not change here, so there is no SQL and no database write: the rows
 * already point exactly where these objects live. That also means CloudFront
 * will keep serving the old bytes until the paths are invalidated, which is the
 * step that actually makes this visible.
 */

// Extensions the originals could have, most likely first. Probed rather than
// assumed because the six HEIC files are a mix of .HEIC and .heic and Max's
// are .jpeg.
const ORIGINAL_EXTENSIONS = [
  ".HEIC",
  ".heic",
  ".jpeg",
  ".jpg",
  ".png",
  ".JPG",
  ".JPEG",
];

const findOriginalFor = async (srgbUrl: string) => {
  const stem = srgbUrl.replace(/-srgb\.jpg$/, "");
  if (stem === srgbUrl) return null;

  for (const ext of ORIGINAL_EXTENSIONS) {
    const candidate = `${stem}${ext}`;
    const response = await fetch(candidate, { method: "HEAD" });
    if (response.ok) return candidate;
  }
  return null;
};

const orientationOf = async (bytes: Buffer) => {
  try {
    return (await sharp(bytes).metadata()).orientation ?? null;
  } catch {
    return null;
  }
};

const fixOrientation = async () => {
  const { data, error } = await supabase
    .from(tables.models)
    .select("*")
    .in(
      "id",
      TARGETS.filter((t) => t.mode === "convert").map((t) => t.modelId),
    )
    .order("id");

  if (error) throw new Error(`Could not read models: ${error.message}`);
  const models = (data ?? []) as IModel[];

  console.log("\n=== ORIENTATION REPAIR ===");
  console.log(
    confirmed
      ? "  Re-uploading to the SAME keys. No database change, no SQL.\n"
      : "  Dry run. Nothing is written.\n",
  );

  let needed = 0;
  let fixed = 0;

  for (const model of models) {
    const target = TARGETS.find((t) => t.modelId === model.id);
    console.log(`${target?.petName ?? model.name} (model ${model.id})`);

    for (const url of model.training_images ?? []) {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(
          `  HTTP ${response.status}  ${path.basename(keyFromUrl(url))}`,
        );
        continue;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const before = await orientationOf(bytes);
      const name = path.basename(keyFromUrl(url));

      // orientation 1 is upright; absent means no tag to honour or ignore.
      // Either way there is nothing for a reader to get wrong.
      if (before === null || before === 1) {
        console.log(`  ok    orientation=${before ?? "none"}  ${name}`);
        continue;
      }

      needed += 1;

      // Prefer redoing the conversion from the original: rotating the existing
      // JPEG would put it through a second lossy encode for no reason. The
      // originals were never overwritten, so they are still there.
      const original = await findOriginalFor(url);
      let repaired: Buffer;
      let source: string;

      if (original) {
        const originalBytes = Buffer.from(
          await (await fetch(original)).arrayBuffer(),
        );
        const format = sniffFormat(originalBytes);
        repaired =
          format === "image/heic"
            ? await convertHeicWithSips(
                originalBytes,
                path.basename(keyFromUrl(original)),
              )
            : (
                await convertToSrgbJpeg(
                  originalBytes,
                  path.basename(keyFromUrl(original)),
                )
              ).buffer;
        source = `re-converted from ${path.basename(keyFromUrl(original))}`;
      } else {
        repaired = await sharp(bytes)
          .rotate()
          .jpeg({ quality: Number(SIPS_QUALITY) })
          .toBuffer();
        source = "rotated in place (original not found)";
      }

      const after = await orientationOf(repaired);
      console.log(
        `  FIX   orientation=${before} -> ${after ?? "none"}  ${name}`,
      );
      console.log(
        `          ${source}, ${(bytes.length / 1024).toFixed(0)}kB -> ${(repaired.length / 1024).toFixed(0)}kB`,
      );

      if (!confirmed) continue;

      const uploaded = await uploadFileToS3({
        buffer: repaired,
        fileType: "image/jpeg",
        Key: keyFromUrl(url),
      });

      if (!uploaded) {
        console.log("          UPLOAD FAILED");
        continue;
      }
      fixed += 1;
      console.log("          re-uploaded to the same key");
    }
    console.log("");
  }

  if (!confirmed) {
    console.log(
      `Dry run: ${needed} photo(s) need orientation baked in. Nothing written.`,
    );
    console.log("Re-run with --confirm to re-upload them.\n");
    return;
  }

  console.log(`${fixed} of ${needed} photo(s) re-uploaded.\n`);
  console.log("NOW INVALIDATE CLOUDFRONT, or none of this is visible:");
  console.log(
    "  the keys are unchanged, so the CDN keeps serving the old bytes.",
  );
  console.log(
    "  Console -> CloudFront -> the d155jdfit5sgy distribution -> Invalidations",
  );
  console.log("  Path: /training-images/*\n");
};

const main = async () => {
  console.log("PrintPetz sRGB backfill");

  if (process.argv.includes("--fix-orientation")) {
    await fixOrientation();
    return;
  }

  console.log(
    confirmed
      ? "  MODE: --confirm, will write new objects to S3\n"
      : "  MODE: dry run, nothing is written\n",
  );

  const { data, error } = await supabase
    .from(tables.models)
    .select("*")
    .in(
      "id",
      TARGETS.map((t) => t.modelId),
    )
    .order("id");

  if (error) throw new Error(`Could not read models: ${error.message}`);
  const byId = new Map(((data ?? []) as IModel[]).map((m) => [m.id, m]));

  // Refuse rather than silently skip: a backfill that quietly left Tom and
  // George broken would look like it succeeded.
  const heicInScope = TARGETS.some(
    (t) => t.mode === "convert" && [15, 16].includes(t.modelId),
  );
  if (heicInScope && process.platform !== "darwin") {
    throw new Error(
      "Tom and George are HEIC, which needs macOS sips to decode -- sharp cannot. " +
        `This is ${process.platform}. Run the backfill on the Mac.`,
    );
  }

  if (confirmed) {
    for (const key of ["AWS_ACCESS_KEY", "AWS_SECRET_KEY", "AWS_BUCKET"]) {
      if (!process.env[key]?.trim())
        throw new Error(`${key} is not set; --confirm needs it.`);
    }
  }

  const sqlUpdates: Array<{ model: IModel; petName: string; urls: string[] }> =
    [];
  let totalConverted = 0;

  for (const target of TARGETS) {
    const model = byId.get(target.modelId);
    if (!model) {
      console.log(
        `  ${target.petName} (id ${target.modelId}): NOT FOUND, skipped\n`,
      );
      continue;
    }

    const header = `${target.petName} (model ${target.modelId}) — ${target.note}`;

    if (target.mode === "verify") {
      console.log(`${header}  [VERIFY ONLY]`);
      let allClean = true;
      for (const url of model.training_images ?? []) {
        const response = await fetch(url);
        const bytes = Buffer.from(await response.arrayBuffer());
        const { format, profile, acceptable } = classify(bytes);
        if (!acceptable) allClean = false;
        console.log(
          `  ${acceptable ? "ok  " : "BAD "} ${format}${profile ? `, ${profile}` : ", no profile"}  ${path.basename(keyFromUrl(url))}`,
        );
      }
      console.log(
        allClean
          ? "  -> still clean. Nothing to do, no S3 writes, no SQL.\n"
          : "  -> NO LONGER CLEAN. Stop and re-check the audit before going further.\n",
      );
      continue;
    }

    console.log(header);
    const plans = await planForModel(target, model);
    const needWork = plans.filter((p) => p.newKey);

    for (const plan of plans) {
      if (!plan.newKey) {
        console.log(`  skip  ${plan.filename}  (${plan.reason})`);
        continue;
      }
      console.log(`  CONVERT  ${plan.reason}`);
      console.log(`      from  ${plan.originalKey}`);
      console.log(`      to    ${plan.newKey}`);
      if (plan.converted) {
        console.log(
          `      size  ${(plan.converted.length / 1024).toFixed(0)}kB`,
        );
      }
    }

    if (needWork.length === 0) {
      console.log("  -> nothing to convert for this pet.\n");
      continue;
    }

    if (!confirmed) {
      totalConverted += needWork.length;
      console.log(
        `  -> dry run: ${needWork.length} photo(s) would be converted.\n`,
      );
      continue;
    }

    // All or nothing. A half-converted pet still fails every theme, because one
    // bad reference fails the whole request -- and it looks repaired, which is
    // worse than obviously broken.
    const newUrls: string[] = [];
    let modelOk = true;

    for (const plan of plans) {
      if (!plan.newKey || !plan.converted) {
        newUrls[plan.index] = plan.originalUrl;
        continue;
      }

      const url = await uploadFileToS3({
        buffer: plan.converted,
        fileType: "image/jpeg",
        Key: plan.newKey,
      });

      if (!url) {
        console.log(`  FAILED to upload ${plan.filename}`);
        modelOk = false;
        break;
      }

      // Re-fetch and re-classify what actually landed. An upload that silently
      // produced a broken object must never reach the SQL.
      const check = await fetch(url);
      const verified =
        check.ok && classify(Buffer.from(await check.arrayBuffer())).acceptable;
      if (!verified) {
        console.log(`  FAILED verification after upload: ${plan.newKey}`);
        modelOk = false;
        break;
      }

      console.log(`  uploaded + verified  ${plan.newKey}`);
      newUrls[plan.index] = url;
      totalConverted += 1;
    }

    if (!modelOk) {
      console.log(
        `  -> ${target.petName} SKIPPED from the SQL: not every photo verified.\n`,
      );
      continue;
    }

    sqlUpdates.push({ model, petName: target.petName, urls: newUrls });
    console.log(
      `  -> ${target.petName} ready, ${needWork.length} photo(s) converted.\n`,
    );
  }

  if (!confirmed) {
    console.log(
      `Dry run complete. ${totalConverted} photo(s) would be converted.`,
    );
    console.log("Nothing was written to S3 and no SQL was generated.");
    console.log("Re-run with --confirm to perform the uploads.\n");
    return;
  }

  if (sqlUpdates.length === 0) {
    console.log("No model completed successfully, so no SQL was written.\n");
    return;
  }

  const lines: string[] = [];
  lines.push(
    "-- PrintPetz — point training_images at the converted sRGB photos",
  );
  lines.push(
    `-- Generated ${new Date().toLocaleDateString("en-CA")} by scripts/backfill-srgb-photos. NOT run by Claude.`,
  );
  lines.push("-- Review, then apply in Supabase.");
  lines.push("--");
  lines.push(
    "-- Every original S3 object is untouched. These updates only repoint the",
  );
  lines.push(
    "-- rows at the converted copies, so the reversal at the bottom is complete.",
  );
  lines.push("--");
  lines.push(
    "-- Each model is all-or-nothing: a model only appears here if EVERY one of",
  );
  lines.push(
    "-- its photos was converted, re-fetched from S3 and re-classified as",
  );
  lines.push(
    "-- acceptable. One bad reference fails every theme, so a partial repair",
  );
  lines.push("-- would look fixed and still be broken.");
  lines.push("");
  lines.push("begin;");
  lines.push("");

  for (const { model, petName, urls } of sqlUpdates) {
    lines.push(`-- ${petName} (model ${model.id})`);
    lines.push("-- BEFORE (for the reversal at the bottom):");
    for (const url of model.training_images ?? []) lines.push(`--   ${url}`);
    lines.push(
      `update public.models set training_images = ${sqlTextArray(urls)}\n  where id = ${model.id};`,
    );
    lines.push("");
  }

  lines.push(
    "-- Expect one row per model above, each showing the -srgb.jpg URLs.",
  );
  lines.push(
    `select id, name, pet_name, training_images from public.models where id in (${sqlUpdates.map((u) => u.model.id).join(", ")}) order by id;`,
  );
  lines.push("");
  lines.push("commit;");
  lines.push("");
  lines.push("");
  lines.push(
    "-- ===========================================================================",
  );
  lines.push(
    "-- Reversal. The originals were never overwritten, so this fully restores the",
  );
  lines.push("-- previous state.");
  lines.push(
    "-- ===========================================================================",
  );
  for (const { model, petName, urls } of sqlUpdates) {
    void urls;
    lines.push(`-- ${petName} (model ${model.id})`);
    lines.push(
      `-- update public.models set training_images = ${sqlTextArray(
        model.training_images ?? [],
      )
        .split("\n")
        .join("\n-- ")}\n--   where id = ${model.id};`,
    );
  }
  lines.push("");

  fs.writeFileSync(SQL_OUTPUT, lines.join("\n"));

  console.log(`${totalConverted} photo(s) converted and verified.`);
  console.log(`SQL written: ${SQL_OUTPUT}`);
  console.log("\nNEXT:");
  console.log("  1. Review update-models-training-images-srgb.sql.");
  console.log("  2. Run it in Supabase.");
  console.log(
    `  3. Re-run the audit: node -r module-alias/register lib/scripts/provider-bakeoff.js --audit-color`,
  );
  console.log(
    `     Expect 0 non-sRGB and 0 HEIC for models ${TARGETS.map((t) => t.modelId).join(", ")}.`,
  );
  console.log(
    `  4. Re-run this script; it should report nothing left to do.\n`,
  );
  void AppConstants.cloudfrontDomain;
};

main().catch((error) => {
  console.error(
    "\nBackfill failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
