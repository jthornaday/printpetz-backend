# Backfill the existing bad training photos

## Goal
The four pets the spike depends on — Tom, George, Wizard Test 7, Max test 6 — have training photos GPT-Image-2.5 will accept, with the originals still in S3.

## Done when
- [ ] A dry run prints every photo it would convert, with its current profile or format, and writes nothing.
- [ ] After the real run, `--audit-color` reports **0 non-sRGB and 0 HEIC** for models 15, 16, 23 and 27.
- [ ] Every original S3 object is still fetchable at its original URL and byte-identical to before.
- [ ] `update-models-training-images-srgb.sql` exists, contains one `update` per affected model with the new URL arrays, a before/after verification select, and a commented-out reversal that restores the original arrays.
- [ ] Models NOT in scope (7–12, 14, 17–20, 26, 2, 3, 4) are untouched — `--audit-color` numbers for them are unchanged.
- [ ] A rerun of the script after the SQL has been applied reports nothing left to do.

## Context
- The photos to fix, from the 15 Sept audit:
  | model | pet | problem |
  |---|---|---|
  | 15 | Tom | 3 × HEIC |
  | 16 | George | 3 × HEIC |
  | 23 | Wizard Test 7 | already clean — verify only, convert nothing |
  | 27 | Max test 6 | 4 × Display P3 |
- `models.training_images` is a `string[]` of CloudFront URLs. Order matters only in that it should be preserved.
- **This runs on Jake's Mac, and that is load-bearing.** `sharp` cannot decode HEIC, but macOS `sips` can — verified on Tom's `IMG_0413.HEIC`, which converted to a 5712×4284 sRGB JPEG. So:
  - non-sRGB JPEG/PNG → `convertToSrgbJpeg()` from `src/utils/image_conversion.ts` (milestone 1).
  - HEIC → shell out to `sips -s format jpeg -s formatOptions 92 --matchTo "/System/Library/ColorSync/Profiles/sRGB Profile.icc"`.
  - The script must refuse to run on non-darwin if any HEIC is in scope, rather than silently skipping those pets.
- `src/scripts/provider-bakeoff.ts --audit-color` is the acceptance test. Do not write a second classifier.

## Constraints
- Needs `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_BUCKET`, `SUPABASE_URL`, `SUPABASE_KEY` from env. Never hardcode them; never print them.
- **Claude does not run the SQL.** Write the file; Jake applies it in Supabase.
- New S3 keys are the original key with `-srgb.jpg` appended before the extension, so the pairing stays obvious in the bucket listing.
- Default to dry run. Require an explicit `--confirm` before any S3 write.
- Milestone 1 must be merged first — this imports `convertToSrgbJpeg` from it.

## Free-edit files
- `src/scripts/backfill-srgb-photos.ts` (new)
- `update-models-training-images-srgb.sql` (new, at repo root alongside the other SQL files)

Anything else asks first.

## Out of scope
- The 35 dead 404 rows (Jaydeep id 3, Jack's Dog id 4). Report them, change nothing.
- The 11 superseded dev trainings. They are skipped by design.
- Deleting or overwriting any original S3 object, ever.
- Retraining any LoRA.
- Rerunning the bakeoff.

## Approach (suggested, not mandatory)
- Pin the model ids in a const at the top with a one-line reason each, the way `PET_PICKS` does. Do not select by name — the table has eleven Wizards and seven Maxes.
- For each photo: fetch, classify with the shared helpers, skip anything already acceptable, convert the rest, upload to the `-srgb.jpg` key, and collect the new URL in the original position.
- Verify each converted object by re-fetching it from S3 and re-classifying before writing it into the SQL. A conversion that silently produced a broken object must not reach the database.
- Emit the SQL last, once every photo for that model is confirmed good — a model is all-or-nothing, since one bad reference fails every theme.
- Print a summary: per model, photos converted, photos already fine, bytes before and after.

**Sharpest risk:** a partially-converted model is worse than an unconverted one, because it looks fixed and still fails. Build each model's new URL array in memory and only write its `update` statement if every photo in it verified. If any photo fails, skip that model entirely and say so loudly.

## House rules
- STOP at forks only (unexpected number, broken done-when, API spend, anything irreversible). Always STOP before any commit, push, or delete.
- Ask before touching credentials, .env files, secrets, or any production database.
- Prefer the simplest thing that passes every "Done when" check. Eliminate redundancy; do not add features not listed above.
- If a "Done when" check turns out to be impossible or wrong, stop and say so rather than working around it.
- Finish by running through the "Done when" list and reporting pass/fail on each.

## Kick-off prompt
Read specs/srgb-photo-backfill.md and execute it. Follow the House rules exactly. Milestone 1 (specs/srgb-upload-conversion.md) must already be merged.
