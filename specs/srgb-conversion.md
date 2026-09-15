# sRGB conversion — parent spec

## Goal
Stop wide-gamut and HEIC training photos from reaching GPT-Image-2.5, both for new uploads and for the pets already in the table.

## Why this is split
Two milestones with different risk profiles, different verification, and different places they run. Do them in order — the second imports the conversion function the first writes.

| | milestone | where it runs | verified by |
|---|---|---|---|
| 1 | [srgb-upload-conversion](srgb-upload-conversion.md) | Elastic Beanstalk, every future upload | upload a P3 photo, audit says sRGB |
| 2 | [srgb-photo-backfill](srgb-photo-backfill.md) | Jake's Mac, once, against existing rows | `--audit-color` reports 0 rejects for in-use pets |

**Do milestone 1 first.** It writes `convertToSrgbJpeg()`, which milestone 2 imports rather than reimplements. Milestone 2 is roughly an hour once milestone 1 has landed.

## The finding this rests on
From the 14–15 Sept audit (`--audit-color`, 181 photos across 26 models):

- **50 photos carry an explicit non-sRGB ICC profile** — Display P3 ×48, Adobe RGB (1998) ×2. OpenAI rejects these with `Invalid image file or mode`.
- **6 photos are unconverted HEIC** (Tom id 15, George id 16).
- **34 photos carry no embedded profile at all, and those are fine.** Wizard Test 7 is all no-profile and passed 13/13 in the bakeoff. An absent profile is not a problem; an explicit wide-gamut one is.
- 35 photos 404 (Jaydeep id 3, Jack's Dog id 4) — dead rows, out of scope for both milestones.

`sips -g profile` reports the *assumed* colour space and calls no-profile files "sRGB IEC61966-2.1". Do not use it to classify. `--audit-color` parses the actual embedded ICC and is the tool of record.

## Decisions already made (do not relitigate)
- Backfill writes **new S3 objects** and emits SQL to repoint `models.training_images`. Originals are never overwritten.
- HEIC uploads are **rejected at upload** with a message naming the file and the iPhone setting. No server-side HEIC decoding.
- Backfill covers **in-use pets only**: 15 Tom, 16 George, 23 Wizard Test 7, 27 Max test 6. Superseded dev trainings (7–12, 14, 17–20, 26, 2) are skipped.
- Conversion applies to **`TRAINING_IMAGE` uploads only**. Profile, generation and model uploads are untouched.

## Out of scope
- The 35 dead 404 rows.
- Retraining any FAL LoRA. Existing models are already trained; converting the source photos does not and need not change them.
- Resizing, cropping or any quality change beyond what the colour conversion requires.
- Rerunning the bakeoff. That is a separate call once both milestones are done.
