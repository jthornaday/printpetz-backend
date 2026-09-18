# Diagnose and improve HEIC decode failures

## Goal
Some real iPhone HEIC photos (e.g. IMG_2192.heic, uploaded live on printpetz.com) fail
decode in `decodeHeic` even though the file is a normal photo. HEIC uploads were never
rejected before 79d2225: the old code stored the bytes untouched and that always worked.
The decode step is what introduced the possibility of rejection, and heic-convert's WASM
libheif does not read every HEIC variant Apple produces. A customer must never be
blocked from creating a model over this. When conversion fails, store the original HEIC
bytes untouched (the pre-decode behaviour) and log the real error, accepting that one
photo misses the colour-profile fix.

## Context
- `decodeHeic` in `src/utils/image_conversion.ts` wraps `decodeHeicToPng` in a bare
  `catch { throw new UnsupportedImageError(...) }` with no logging of the real error.
- This shipped in commit 79d2225 ("Convert HEIC uploads to sRGB JPEG instead of refusing
  them"), merged PR #40, deployed to production Sept 18.
- Confirmed live and working for most HEIC uploads (historical figures theme testing went
  smoothly on other photos same day). This specific failure is on file `IMG_2192.heic`.
- Suspected causes: a Live Photo export, a Portrait-mode HEIC with embedded depth/aux
  images, a burst-photo HEIC container, or genuine file corruption — heic-convert's WASM
  libheif build may not support all of these container variants.

## Done when
- [ ] A HEIC that fails at any conversion step (parse, decode, or the sRGB re-encode) does
      NOT throw and does NOT 400. `convertToSrgbJpeg` returns the original bytes with
      `contentType: "image/heic"`, `converted: false`, `replacedProfile: null`, and the
      upload stores them untouched under the original filename.
- [ ] Each fallback logs one `[heic-decode-failed]` line server-side with the filename,
      byte size, error constructor name, error message and container brand, so the
      rate and cause are visible in CloudWatch/EB logs.
- [ ] A HEIC that decodes fine still converts to an sRGB JPEG (no regression), and a
      non-image (GIF/PDF/etc.) is still refused with a 400 naming the file.
- [ ] If the real IMG_2192.heic is available, the actual decode failure reason is
      identified and reported (not guessed), and whether a fix is reasonable is noted.
      Not required for the fallback to ship.
- [ ] `npm run build` is clean.

## Constraints
- Don't change the public shape of `convertToSrgbJpeg`'s return value or the HTTP-level
  behavior for already-working cases. `UnsupportedImageError` remains for non-images only.
- Don't touch the FAL path, the generation path, or anything outside
  `src/utils/image_conversion.ts` and its tests/scripts.

## Free-edit files
- `src/utils/image_conversion.ts`

Anything else asks first.

## Approach (suggested, not mandatory)
1. Wrap the whole HEIC path in one try/catch that logs and returns the original bytes.
2. If the real file is available locally, run `convertToSrgbJpeg` on it directly and print
   the real error before deciding whether a decode fix is worth attempting.

## House rules
- STOP at forks only (unexpected number, broken done-when, API spend, anything
  irreversible). Always STOP before any commit, push, merge, or delete.
- Ask before touching credentials, .env files, secrets, or any production database.
- Prefer the simplest thing that passes every "Done when" check.
- Finish by running through the "Done when" list and reporting pass/fail on each.

## Kick-off prompt
Read specs/heic-decode-diagnostics.md and execute it. I have the failing photo
(IMG_2192.heic) — [FILL IN: path to the file on this Mac, e.g. ~/Desktop/IMG_2192.heic].
Use it to reproduce locally rather than guessing at the cause.
