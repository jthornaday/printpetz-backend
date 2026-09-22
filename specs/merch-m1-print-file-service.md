# M1 — Print-file service

## Goal
Given a generated image and a product, produce a print-ready file the POD provider
will accept without a human touching it.

## Done when
- [ ] `npm run print-file -- --image=<path> --product=poster_8x10` writes a file and
      prints its dimensions, DPI and target product.
- [ ] Every product in the catalog table below produces a file at exactly the pixel
      dimensions and embedded DPI that table specifies.
- [ ] `canvas_16x20` output is 3800x4600 with 1.5in of mirrored bleed on all four
      sides, and the visible 16x20 region contains the whole pet — no ear, paw or tail
      crosses into the wrap.
- [ ] For a non-4:5 product (coaster, pillow), the crop keeps the pet centred and
      whole. A center-crop that clips an ear is a failure, not a near-miss.
- [ ] Running the service twice on the same image and product produces byte-identical
      output.
- [ ] `--treatment=cutout` produces a transparent PNG with no visible halo when
      composited on a LIGHT background, and `--treatment=panel` produces the full scene.
- [ ] Jake can run one command on a Wizard generation and get a file he could upload
      to Printful without editing it.

## Context — what M0 settled, do not re-litigate
`specs/merch-m0-report.md` has the full evidence. The short version:

- **Use Lanczos.** It beat aura-sr, esrgan and clarity on fidelity for all five
  regression pets, with zero colour drift (measured 0.0 vs 4.3-13.0 for the AI
  upscalers). It is free, instant, has no API dependency and cannot alter a pet.
- **Do NOT call an AI upscaler.** Not for quality, not as a fallback, not "just for
  canvas". If a printed 4x ever proves too soft, aura-sr is the measured second
  choice — but that decision is Jake's and is not part of this milestone.
- **Always resample ONCE, from the original 832x1024.** Never upscale an already
  upscaled file. Double resampling compounds softness.
- **All tiers (2x, 3x, 4x) are confirmed on physical prints** across multiple pets
  including Wizard — solid black cat, the hardest case, confirmed at 3.91x on a
  16x20. Do not re-open the upscaling question.

`sharp` is already a dependency. Use `kernel: 'lanczos3'`.

## Product catalog

Source is 832x1024 (4:5 = 0.8125). Crop to the product's aspect BEFORE resizing.

Each row below is available in BOTH treatments unless noted.

| product key | visible | DPI | bleed | output px | aspect | crop? |
|---|---|---|---|---|---|---|
| `poster_8x10` | 8x10 in | 300 | none | 2400x3000 | 4:5 | no |
| `framed_8x10` | 8x10 in | 300 | none | 2400x3000 | 4:5 | no |
| `canvas_16x20` | 16x20 in | 200 | 1.5 in | 3800x4600 | 4:5 | no |
| `coaster_4x4` | 4x4 in | 300 | none | 1200x1200 | 1:1 | **yes** |
| `mug_11oz` | 4x4.5 in | 300 | none | 1200x1350 | ~8:9 | **yes** |
| `koozie` | 3.5x4 in | 300 | none | 1050x1200 | ~7:8 | **yes** |
| `pillow_18x18` | 18x18 in | 150 | none | 2700x2700 | 1:1 | **yes** |

Wall art (`poster_8x10`, `framed_8x10`, `canvas_16x20`) defaults to `panel` — the
background is the artwork there — but `cutout` stays available if a customer wants it.

`pillow_18x18` was gated pending a 4x print test. **That gate is lifted** — Jake
printed Wizard at 16x20 (3.91x) on 2026-09-22 and it works. All tiers are proven.

Exact print areas for mug, koozie and coaster are estimates. Confirm against the
provider's own product spec before these go live, and correct the table here.

## Subject-aware cropping
Only for products marked crop=yes. 8x10 and 16x20 are native 4:5 and must not crop.

A blind center-crop cuts ears off. Use the existing `fal-ai/imageutils/rembg` call
already wired at `src/services/fal_service.ts:339` to get a subject mask, take its
bounding box, and centre the crop on that box rather than on the image. Clamp so the
crop never leaves the image bounds.

rembg is a paid call, so only invoke it when a crop is actually required, and cache
the resulting bbox per generation id so a customer ordering three square products
pays for one mask.

If rembg fails, fall back to a center-crop and log it. Do not fail the order.

## Constraints
- No AI upscaler calls. Lanczos only.
- Do not change anything in the live generation path. This service is downstream —
  it reads a finished image and produces a derivative.
- No writes to the generations table.
- Output sRGB. Embed the DPI in the file metadata; providers read it.
- PNG for anything needing transparency later, JPEG quality >=95 with no chroma
  subsampling otherwise.

## Free-edit files
- `src/services/print_file_service.ts` (new)
- `src/constants/print_products.ts` (new — the catalog table above)
- `src/scripts/print-file.ts` (new — the CLI entry)
- `src/scripts/rembg-test.ts` (exists — scratch, may be deleted or folded in)
- `package.json` — the `print-file` script entry only
- `specs/merch-m1-print-file-service.md` (this file)

Everything outside this list asks first.

## Treatments — panel and cutout, both, customer-selectable
**DECIDED 2026-09-22.** Every product takes a `treatment` alongside its product key:

- `panel` — the full generated scene as a rectangle. No processing. Free.
- `cutout` — background removed, pet floats on the garment/product colour.

Jake's call, and correct: the marginal cost of supporting both is small, and fewer
options means fewer sales. Do NOT hard-map a treatment per SKU — the customer picks.

`cutout` uses `fal-ai/imageutils/rembg`, already wired at `src/services/fal_service.ts:337`
as `handleRemoveBackground(imageUrl)`. Reuse it; do not write a second caller.

### Tested 2026-09-22 — rembg is viable
Run on Wizard (thin bright whiskers on black fur) and Moses (wispy curly coat), the
two hardest masks in the regression set. Both came back clean: ear-tip fur tufts
survive, curly coat edges survive, nothing chopped. Output at `<pet>/rembg-4x.png`.

A prediction that proved WRONG and is recorded so nobody re-reasons their way back
into it: a black pet cut out on a dark garment does NOT vanish. The white uniform
carries the silhouette and the cap and eyes anchor the face. See
`Claude outputs/upscale-eval/_crops/Wizard-full-DARK.jpg`. Dark garments are fine.

### Two defects to handle
1. **Matting halo.** rembg leaves soft semi-transparent fringe pixels. Invisible on
   dark garments, visible as grey fringing on light ones — worst along hard edges like
   the bat. Erode the alpha 1-2px and clamp the fringe. Verify on a LIGHT background,
   not a dark one; dark hides the defect.
2. **Props guillotined at the frame edge.** Wizard's bat runs off the top-left of the
   source frame. In a panel that reads as an intentional crop. Floating on a garment it
   looks broken — a bat ending in mid-air. Either detect prop geometry crossing the
   frame boundary and flag it, or accept it and say so. Do not ship it unnoticed.

## Out of scope
- Any Shopify, cart, checkout, order or credits work. M2 onward.
- Uploading files anywhere. This writes to disk; M3 handles delivery.
- Re-testing upscalers. M0 settled it.
- 24x36 posters. Unreachable at any factor.

## Approach (suggested, not mandatory)
- Put the catalog in a plain data file so adding a product is a table row, not code.
  Jake will keep adding products.
- One pure function: (image buffer, product key) -> print-ready buffer + metadata.
  The CLI is a thin wrapper. That keeps M3 able to call it directly.
- Order of operations matters: crop to aspect FIRST, then one Lanczos resize to final
  size, then add bleed by mirroring. Resizing before cropping wastes pixels and
  softens the result.
- Verify against the known-good reference files already built by hand in
  `Claude outputs/upscale-eval/Darla/` — `Darla-8x10-300dpi.jpg` (2400x3000) and
  `Darla-16x20-canvas-print.jpg` (3800x4600). The service should reproduce those
  dimensions exactly from `Darla/original.jpg`.
- Biggest risk: someone "improves" this later by adding an upscaler because the output
  looks soft on screen. It looked soft on screen and printed fine. Leave a comment in
  the code saying so, pointing at the M0 report.

## House rules
- STOP at forks only (unexpected number, broken done-when, API spend, anything
  irreversible). Always STOP before any commit, push, or delete.
- Ask before touching credentials, .env files, secrets, or any production database.
- Prefer the simplest thing that passes every "Done when" check. Eliminate redundancy;
  do not add features not listed above.
- If a "Done when" check turns out to be impossible or wrong, stop and say so rather
  than working around it.
- Finish by running through the "Done when" list and reporting pass/fail on each.

## Kick-off prompt
Read specs/merch-m1-print-file-service.md and execute it. Follow the House rules
exactly. Read specs/merch-m0-report.md first — it settles the upscaling
question and you must not revisit it. Lanczos only, no AI upscalers.
