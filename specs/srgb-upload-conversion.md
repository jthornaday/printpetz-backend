# Convert training photos to sRGB at upload

> **Superseded in part (HEIC).** HEIC uploads are no longer refused: `convertToSrgbJpeg` decodes them with `heic-convert` in a worker thread and returns an sRGB JPEG, keeping the photo's own ICC profile. The HEIC-rejection checklist item, the "Server-side HEIC decoding" non-goal and the reject-the-batch-on-HEIC rule below describe the earlier behaviour. See `src/utils/image_conversion.ts`.

## Goal
Every training photo that reaches S3 from now on is an sRGB JPEG, and HEIC uploads are refused with a message the customer can act on.

## Done when
- [ ] Uploading a Display P3 JPEG to `POST /file/upload?type=TRAINING_IMAGE` stores an sRGB JPEG. Verified by running `--audit-color` afterwards and seeing that model's photo counted under sRGB, not non-sRGB.
- [ ] Uploading a photo that is already sRGB, or has no embedded profile, stores the **original bytes unchanged** — no re-encode, no quality loss. Byte length in S3 matches the uploaded file.
- [ ] Uploading a `.HEIC` file returns HTTP 400 whose message names the offending filename and tells the user to switch to Most Compatible on iPhone. Nothing is written to S3 for that request.
- [ ] Uploading to any other type (`PROFILE_IMAGE`, `GENERATION_IMAGE`, `MODEL`) behaves exactly as it does today.
- [ ] `npm run build` is clean and `npx tsc --noEmit` reports no new errors.
- [ ] `sharp` appears in `dependencies` in `package.json` and `package-lock.json`, and `npm ci` from a clean checkout installs it.

## Context
- Uploads land at `src/router/file_router.ts` → `multer()` in memory → `src/controllers/file_controller.ts`, which passes `file.buffer` and `file.mimetype` straight to `uploadFileToS3`. **`fileType: file.mimetype` is the root cause**: whatever the browser claims is what S3 stores, and nothing looks at the bytes.
- The frontend uploads through this API (`useUploadFileMutation`), never directly to S3, so this is a backend-only change. Batches of up to 5 files per request (`upload.array("file", 5)`).
- `src/scripts/provider-bakeoff.ts` already contains working ICC parsing — `jpegIccProfile`, `iccDescription`, `pngProfileName`, `readColorProfile`, `sniffFormat`, `classify`. **Reuse these by extracting them, do not rewrite them.** They were validated against `sips` on nine known files.
- Verified conversion recipe, tested on a real Display P3 photo from Max test 6 and confirmed sRGB afterwards by both `sips` and the ICC parser:
  ```ts
  sharp(buffer).rotate().toColorspace("srgb").withMetadata({ icc: "srgb" }).jpeg({ quality: 92 }).toBuffer()
  ```
  `.rotate()` applies EXIF orientation to the pixels before metadata is dropped. Max's photos carry EXIF orientation; without this they come out sideways.

## Constraints
- Node 22, TypeScript, CommonJS, `tsc` → `lib/`, module-alias `@` → `lib`.
- **`sharp` is currently installed in `node_modules` but is NOT in `package.json`** — it was added with `--no-save` during the audit. It must be added properly or EB will deploy without it and every training upload will 500.
- Do not change `uploadFileToS3` or `aws_service.ts`.
- Do not touch the FAL path, the generation path, or anything under `src/services/providers/`.

## Free-edit files
- `src/controllers/file_controller.ts`
- `src/utils/image_conversion.ts` (new)
- `src/scripts/provider-bakeoff.ts` (only to import from the new module instead of holding its own copies)
- `package.json`, `package-lock.json`

Anything else asks first.

## Out of scope
- Server-side HEIC decoding. sharp's prebuilt binary parses the container but cannot decode the pixels (`Decoder plugin generated an error`), and that will be identical on EB Linux. Rejecting is the decision.
- Client-side HEIC conversion in the frontend.
- Backfilling existing photos — that is [srgb-photo-backfill](srgb-photo-backfill.md).
- Resizing or recompressing photos that are already fine.

## Approach (suggested, not mandatory)
- Move the ICC/format helpers out of `provider-bakeoff.ts` into `src/utils/image_conversion.ts` and import them back, so there is one implementation.
- Export `convertToSrgbJpeg(buffer): Promise<{ buffer, contentType, converted, reason }>` from that module. It decides from the **bytes**, never from `file.mimetype`:
  - HEIC → throw a typed error carrying the filename.
  - Not PNG/JPEG/WebP → throw the same typed error.
  - Explicit non-sRGB ICC → convert, return `converted: true`.
  - sRGB or no profile → return the input untouched, `converted: false`.
- In `file_controller`, apply it only when `type === "TRAINING_IMAGE"`. Set the S3 `fileType` from the sniffed format, not from `file.mimetype`, so a mislabelled upload can never poison the object again.
- Reject the whole request if any file in the batch is HEIC, rather than silently uploading 4 of 5 — a half-uploaded training set is worse than a clear error.
- Log one line per converted file with the profile name it replaced, so the rate of this in the wild becomes visible.

**Sharpest risk:** sharp is a native binary. If EB's build does not produce a linux-x64 binary, training uploads fail in production while working locally. Before merging, confirm the EB deploy log shows sharp installing, and upload one photo through the deployed environment rather than trusting the local test.

## House rules
- STOP at forks only (unexpected number, broken done-when, API spend, anything irreversible). Always STOP before any commit, push, or delete.
- Ask before touching credentials, .env files, secrets, or any production database.
- Prefer the simplest thing that passes every "Done when" check. Eliminate redundancy; do not add features not listed above.
- If a "Done when" check turns out to be impossible or wrong, stop and say so rather than working around it.
- Finish by running through the "Done when" list and reporting pass/fail on each.

## Kick-off prompt
Read specs/srgb-upload-conversion.md and execute it. Follow the House rules exactly.
