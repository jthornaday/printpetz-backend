#!/usr/bin/env node
/**
 * PrintPetz — resize the 37 themes added Sept 19-20 to 512x512 WebP, push them
 * to S3, and emit the SQL that points styles.image at them.
 *
 * Derived from scripts/upload-new-thumbnails.mjs (the original 37). This script
 * UPLOADS to S3. It never touches the database: it writes
 * update-new-styles-thumbnails.sql for Jake to run in Supabase, matching the
 * standing rule that Claude does not run SQL against production.
 *
 * The source images are opened read-only. Nothing in ~/Downloads is modified,
 * moved or deleted — conversion happens in memory.
 *
 * Usage (see printCommand() for the exact line):
 *   npm i --no-save sharp && AWS_ACCESS_KEY=... AWS_SECRET_KEY=... AWS_BUCKET=... \
 *     node scripts/upload-new-thumbnails.mjs
 *
 * Flags:
 *   --dry-run   convert and report, upload nothing, still write the SQL
 *   --force     upload even if the match report has unmatched files or
 *               styles with no file (default is to abort)
 */


import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOURCE_FOLDERS = [
  { label: "New_37", dir: path.join(os.homedir(), "Downloads/PrintPetz_Thumbnails_37_WebReady") },
];

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MANIFEST_NAME = "manifest.txt";

const TARGET_SIZE = 512;
const WEBP_QUALITY = 82;
const S3_PREFIX = "thumbnails";

// Hard-coded rather than read from Supabase because this script has no database
// credentials by design. The SQL it writes verifies itself against the real
// table: if a name here does not exist there, the final select reports the row
// as still having no image rather than failing silently.
const CLOUDFRONT_DOMAIN = "https://d155jdfit5sgy.cloudfront.net";

const SQL_OUTPUT = path.join(process.cwd(), "update-new-styles-thumbnails.sql");

// The 37 styles added Sept 19-20. The first 34 (Construction, Fantasy,
// Intergalactic) are from insert-fantasy-intergalactic-construction-themes-2026-09-19.sql.
// Master Griller, Firework and American Gothic have no insert file in this repo;
// their names were confirmed by Jake.
const STYLES = [
  // Construction trades
  ["Construction Worker", "Professions"], ["Mason", "Professions"],
  ["Roofer", "Professions"], ["Framer", "Professions"],
  // Fantasy
  ["Wizard", "Fantasy"], ["Knight in Shining Armor", "Fantasy"], ["Elf Ranger", "Fantasy"],
  ["Pixie", "Fantasy"], ["Dragon Rider", "Fantasy"], ["Royal Sorceress", "Fantasy"],
  ["Troll", "Fantasy"], ["Gnome", "Fantasy"], ["Dwarf Lord", "Fantasy"],
  ["Necromancer", "Fantasy"], ["Barbarian", "Fantasy"], ["Thief", "Fantasy"],
  ["Bard", "Fantasy"], ["Witch", "Fantasy"], ["Alchemist", "Fantasy"],
  // Intergalactic
  ["Space Marine", "Intergalactic"], ["Starship Captain", "Intergalactic"],
  ["Galactic Bounty Hunter", "Intergalactic"], ["Smuggler", "Intergalactic"],
  ["Space Pirate", "Intergalactic"], ["Alien Diplomat", "Intergalactic"],
  ["Galactic Royalty", "Intergalactic"], ["Void Knight", "Intergalactic"],
  ["Cosmic Sorcerer", "Intergalactic"], ["Nebula Explorer", "Intergalactic"],
  ["Asteroid Miner", "Intergalactic"], ["Cyborg Engineer", "Intergalactic"],
  ["Android Companion", "Intergalactic"], ["Star Cadet", "Intergalactic"],
  ["Zero-G Racer", "Intergalactic"],
  // Names confirmed by Jake
  ["Master Griller", "Holidays"], ["Firework", "Holidays"], ["American Gothic", "Themes"],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Matching key. Collapses case, punctuation and separators so that
// "Mrs_Claus.png" and the row "Mrs. Claus" land on the same key, and so does
// "Track_and_Field.png" / "Track and Field".
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// S3 key component. Stable across runs so re-running overwrites in place
// rather than orphaning objects and changing every URL.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const sqlQuote = (s) => `'${s.replace(/'/g, "''")}'`;

const fail = (msg) => {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
};

// Placeholders only — never the real values, even when they are already set.
const printCommand = () => {
  console.log("Run this, with your own values substituted in:\n");
  console.log(
    "  npm i --no-save sharp && \\\n" +
      "  AWS_ACCESS_KEY=<access-key> \\\n" +
      "  AWS_SECRET_KEY=<secret-key> \\\n" +
      "  AWS_BUCKET=<bucket-name> \\\n" +
      "  node scripts/upload-new-thumbnails.mjs\n",
  );
  console.log("Add --dry-run to convert and report without uploading.\n");
};

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");

console.log("PrintPetz new-theme thumbnail upload — 512x512 WebP\n");

// Credentials. Checked before anything else, and before any file is read, so a
// missing variable costs nothing. Skipped for --dry-run, which never calls S3.
const env = {
  AWS_ACCESS_KEY: process.env.AWS_ACCESS_KEY,
  AWS_SECRET_KEY: process.env.AWS_SECRET_KEY,
  AWS_BUCKET: process.env.AWS_BUCKET,
};

if (!dryRun) {
  const missing = Object.entries(env)
    .filter(([, v]) => v === undefined || v.trim() === "")
    .map(([k]) => k);

  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(", ")}\n`);
    printCommand();
    process.exit(1);
  }
  // Confirm they are set without echoing them.
  for (const k of Object.keys(env)) console.log(`  ${k}: set (${env[k].length} chars)`);
  console.log();
}

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error("sharp is not installed. It does the WebP encoding — macOS sips can read");
  console.error("WebP but cannot write it, so there is no built-in fallback.\n");
  printCommand();
  process.exit(1);
}

let S3Client, PutObjectCommand;
if (!dryRun) {
  try {
    ({ S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3"));
  } catch {
    fail("@aws-sdk/client-s3 not found. Run this from the backend repo root after npm install.");
  }
}

// ---------------------------------------------------------------------------
// Walk the source folders
// ---------------------------------------------------------------------------

const styleByKey = new Map();
for (const [name, category] of STYLES) {
  const key = norm(name);
  if (styleByKey.has(key)) fail(`two styles normalise to the same key: ${name}`);
  styleByKey.set(key, { name, category });
}

const found = [];   // { label, rel, abs, stem }
const ignored = []; // non-image files

for (const { label, dir } of SOURCE_FOLDERS) {
  if (!fs.existsSync(dir)) fail(`source folder not found: ${dir}`);

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(dir, abs);
      if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push({ label, rel, abs, stem: path.basename(entry.name, path.extname(entry.name)) });
      } else {
        ignored.push({ label, rel });
      }
    }
  };
  walk(dir);

  // Use the manifest where present: it is a plain list of expected basenames.
  // A manifest entry with no file on disk is the failure worth catching —
  // it means the export dropped something.
  const manifestPath = path.join(dir, MANIFEST_NAME);
  if (fs.existsSync(manifestPath)) {
    const listed = fs.readFileSync(manifestPath, "utf8")
      .split("\n").map((l) => l.trim()).filter(Boolean);
    const onDisk = new Set(
      found.filter((f) => f.label === label).map((f) => path.basename(f.rel)),
    );
    const absent = listed.filter((n) => !onDisk.has(n));
    console.log(`${label}: manifest lists ${listed.length}, ${onDisk.size} image file(s) on disk` +
      (absent.length ? ` — MISSING: ${absent.join(", ")}` : " — all present"));
  } else {
    console.log(`${label}: no manifest.txt, matching on filenames alone`);
  }
}
console.log();

// ---------------------------------------------------------------------------
// Match report — printed before anything is uploaded
// ---------------------------------------------------------------------------

const matched = new Map(); // style name -> [file, ...]
const unmatched = [];

for (const file of found) {
  const style = styleByKey.get(norm(file.stem));
  if (!style) {
    unmatched.push(file);
    continue;
  }
  if (!matched.has(style.name)) matched.set(style.name, []);
  matched.get(style.name).push(file);
}

const noFile = STYLES.filter(([name]) => !matched.has(name));
const duplicates = [...matched.entries()].filter(([, files]) => files.length > 1);

console.log("MATCH REPORT");
console.log(`  image files found     ${found.length}`);
console.log(`  non-image ignored     ${ignored.length}${ignored.length ? "  (" + ignored.map((i) => i.rel).join(", ") + ")" : ""}`);
console.log(`  styles rows expected  ${STYLES.length}`);
console.log(`  matched               ${matched.size}`);
console.log(`  unmatched files       ${unmatched.length}`);
console.log(`  styles with no file   ${noFile.length}`);
console.log(`  duplicate matches     ${duplicates.length}`);

if (unmatched.length) {
  console.log("\n  UNMATCHED FILES (no styles row with this name):");
  for (const f of unmatched) console.log(`    ${f.label}/${f.rel}`);
}
if (noFile.length) {
  console.log("\n  STYLES WITH NO FILE:");
  for (const [name, category] of noFile) console.log(`    ${name}  [${category}]`);
}
if (duplicates.length) {
  console.log("\n  DUPLICATE MATCHES (one style, several files):");
  for (const [name, files] of duplicates) {
    console.log(`    ${name}:`);
    for (const f of files) console.log(`      ${f.label}/${f.rel}`);
  }
}
console.log();

if ((unmatched.length || noFile.length || duplicates.length) && !force) {
  fail("match report is not clean. Fix the files above, or re-run with --force to upload anyway.");
}

// ---------------------------------------------------------------------------
// Convert and upload
// ---------------------------------------------------------------------------

const s3 = dryRun
  ? null
  : new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: env.AWS_ACCESS_KEY, secretAccessKey: env.AWS_SECRET_KEY },
    });

console.log(dryRun ? "CONVERTING (dry run, nothing is uploaded)\n" : "CONVERTING AND UPLOADING\n");

const results = [];
let totalIn = 0;
let totalOut = 0;

for (const [name, category] of STYLES) {
  const files = matched.get(name);
  if (!files) continue;
  const file = files[0];

  const meta = await sharp(file.abs).metadata();
  if (meta.width !== meta.height) {
    // fit: "cover" would crop a non-square source. Every file today is
    // 1254x1254, so this is a guard against a future export, not a live case.
    console.log(`  ! ${name}: source is ${meta.width}x${meta.height}, not square — will be centre-cropped`);
  }

  const buffer = await sharp(file.abs)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  const inBytes = fs.statSync(file.abs).size;
  totalIn += inBytes;
  totalOut += buffer.length;

  const Key = `${S3_PREFIX}/${slug(name)}.webp`;
  const url = `${CLOUDFRONT_DOMAIN}/${Key}`;

  if (!dryRun) {
    await s3.send(new PutObjectCommand({
      Bucket: env.AWS_BUCKET,
      Key,
      Body: buffer,
      ContentType: "image/webp",
      // Seven days rather than immutable: the key is stable, so a re-upload
      // replaces the object in place and a year-long cache would pin the old
      // one in every CDN edge and browser.
      CacheControl: "public, max-age=604800",
    }));
  }

  results.push({ name, category, url, Key, inBytes, outBytes: buffer.length, source: `${file.label}/${file.rel}` });
  const kb = (n) => `${(n / 1024).toFixed(0)}kB`;
  console.log(`  ${dryRun ? "conv" : "up"}  ${name.padEnd(24)} ${kb(inBytes).padStart(8)} -> ${kb(buffer.length).padStart(6)}  ${Key}`);
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
console.log(`\n  ${results.length} images   ${mb(totalIn)} -> ${mb(totalOut)}  (${(100 - (totalOut / totalIn) * 100).toFixed(1)}% smaller)\n`);

// ---------------------------------------------------------------------------
// Emit the SQL
// ---------------------------------------------------------------------------

// Local date, not UTC: the fix logs are dated in Jake's timezone, and a file
// generated on the evening of the 14th should not say the 15th.
const today = new Date().toLocaleDateString("en-CA");

const digest = createHash("sha256")
  .update(results.map((r) => r.url).join("\n"))
  .digest("hex")
  .slice(0, 12);

const lines = [];
lines.push("-- PrintPetz — point styles.image at the 512x512 WebP thumbnails (37 themes added Sept 19-20)");
lines.push(`-- Generated ${today} by scripts/upload-new-thumbnails.mjs. NOT run by Claude.`);
lines.push("-- Review, then apply in Supabase.");
lines.push("--");
lines.push(`-- ${results.length} rows, one per theme, matched by name.`);
lines.push("--");
lines.push("-- Safe to re-run: every statement is an idempotent update by name.");
lines.push(`-- URL set fingerprint: ${digest}`);
lines.push("");
lines.push("-- ===========================================================================");
lines.push("-- Expect 37. A lower number means a name below does not exist in the table.");
lines.push("-- ===========================================================================");
lines.push("select count(*) as rows_that_will_be_updated");
lines.push("from public.styles");
lines.push(`where name in (${results.map((r) => sqlQuote(r.name)).join(", ")});`);
lines.push("");
lines.push("");
lines.push("begin;");
lines.push("");

let lastCategory = null;
for (const r of results) {
  if (r.category !== lastCategory) {
    lines.push(`-- ${r.category}`);
    lastCategory = r.category;
  }
  lines.push(`update public.styles set image = ${sqlQuote(r.url)} where name = ${sqlQuote(r.name)};`);
}

lines.push("");
lines.push("-- Expect: with_thumbnail 37, without_thumbnail 0 (scoped to these 37 names only).");
lines.push("select count(*) filter (where image is not null and image <> '') as with_thumbnail,");
lines.push("       count(*) filter (where image is null or image = '')      as without_thumbnail,");
lines.push("       count(*)                                                 as total_rows");
lines.push("from public.styles");
lines.push(`where name in (${results.map((r) => sqlQuote(r.name)).join(", ")});`);
lines.push("");
lines.push("-- Expect zero rows. Anything listed here is one of the 37 whose name did not");
lines.push("-- match a styles row, or a row that still has no image.");
lines.push("select id, name, category from public.styles");
lines.push(`where name in (${results.map((r) => sqlQuote(r.name)).join(", ")})`);
lines.push("  and (image is null or image = '')");
lines.push("order by category, name;");
lines.push("");
lines.push("commit;");
lines.push("");
lines.push("");
lines.push("-- ===========================================================================");
lines.push("-- Reversal — restores the pre-thumbnail state (image = '') for these 37 only.");
lines.push("-- ===========================================================================");
lines.push(`-- update public.styles set image = '' where name in (${results.map((r) => sqlQuote(r.name)).join(", ")});`);
lines.push("");

fs.writeFileSync(SQL_OUTPUT, lines.join("\n"));
console.log(`SQL written: ${SQL_OUTPUT}`);
console.log(`  ${results.length} updates, fingerprint ${digest}`);
console.log();
console.log("NEXT — in Supabase, in this order:");
console.log("  1. Run update-new-styles-thumbnails.sql (the first select should say 37).");
console.log("  2. Confirm the final select returns zero rows.");
if (dryRun) console.log("\n(dry run — nothing was uploaded to S3)");
