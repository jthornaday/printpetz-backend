# M0 — Can an upscaler hold pet identity at 4x?

## Goal
Find out, for each of 2x / 3x / 4x, whether any upscaler can enlarge a 1024px
PrintPetz generation without changing the pet — and report which upscaler at which
factor, at what cost per image.

Each factor unlocks a different product tier, so a per-factor answer is the point.
A single global pass/fail is not useful. "2x is safe, 4x is not" means launch
drinkware now and defer canvas.

This is an evaluation, not a feature. Nothing ships to production. The deliverable is
images plus a written verdict Jake can look at.

## Done when
- [ ] `npm run upscale-eval` produces output for all 5 regression pets (Wizard,
      Moses, George, Max, Darla) through every candidate upscaler, at 2x, 3x and 4x.
- [ ] Output lands in `Claude outputs/upscale-eval/<pet>/<upscaler>-<factor>x.png`,
      alongside the original at `<pet>/original.png`, so pairs open side by side.
- [ ] `specs/merch-m0-report.md` exists and states, per upscaler and
      per factor: measured cost per image, wall-clock seconds, and a per-pet
      pass/fail on identity with the specific reason for each fail.
- [ ] The report maps results onto the product tiers below and says which tiers are
      shippable:
      - 2x (1664x2048) -> coaster, mug, pint glass, koozie @300 DPI
      - 3x (2496x3072) -> t-shirt/sweatshirt/hoodie @150 DPI, 8x10 poster @300 DPI
      - 4x (3328x4096) -> 16x20 canvas @150 DPI with 1.5in gallery-wrap bleed
- [ ] The report ends with one recommendation line per tier: ship, or don't, and why.
- [ ] Jake can open Wizard's original and Wizard's best 4x upscale side by side and
      see the coat is still black.

## Print targets (researched 2026-09-22)
Provider floors: Printful 150 DPI minimum on most products, 300 for small detailed
items viewed up close (mugs, phone cases) and for posters. DTG t-shirt front print
area is 12x16in = 1800x2400 @150 DPI. Printify 300 recommended, 120-150 large format.
Gelato 150 min / 300 ideal / 600 giclee. All three accept a per-order file URL.

Source is 832x1024 (4:5). Scale factors and what each unlocks:

| Factor | Pixels | Unlocks |
|---|---|---|
| 2x | 1664x2048 | coaster, mug, pint glass, koozie @300 DPI |
| 3x | 2496x3072 | t-shirt / sweatshirt / hoodie @150 DPI; 8x10 poster @300 DPI |
| 4x | 3328x4096 | 16x20 canvas @150 DPI incl. 1.5in bleed (19x23 file) |

24x36 poster needs 10800px long edge. Unreachable. Do not test for it.

**Aspect ratio.** 832x1024 is 4:5 — native for 8x10 and 16x20, no crop. Coasters are
square, mug wraps are landscape, apparel is portrait-ish. Per-product cropping and
compositing is M1 work, NOT M0. M0 judges identity only, on the uncropped image.

## Context
- Generation output today: 832x1024 (OpenAI lane, `openai_provider.ts` DEFAULT_SIZE)
  and 820x1024 (fal lane). Both under 1 MP.
- Provider abstraction lives in `src/services/providers/`, selected by
  `PRINTPETZ_IMAGE_PROVIDER`. fal credentials already exist in this repo
  (`fal_utils.ts`) — reuse them, do not add a new credential path.
- The five regression pets and their known failure modes are in the workspace
  `CLAUDE.md`. Use existing generated images for these pets — do NOT regenerate
  them, that costs credits and introduces a second variable.
- Identity standard, verbatim from CLAUDE.md, is the pass/fail bar: species, coat
  color, coat pattern, facial markings, muzzle structure, ear shape, eye placement,
  head proportions must all survive.

## Candidate upscalers
Conservative first — these enlarge without inventing detail, and are the ones most
likely to pass:
- fal `aura-sr` (4x)
- fal `esrgan`

Creative, included to demonstrate the failure rather than because it will pass:
- fal `clarity-upscaler` at its lowest creativity setting

If a candidate is unavailable on the account, note it in the report and move on.
Do not substitute a different one without saying so.

## Constraints
- Total API spend for this evaluation: **$20 hard cap.** Measure actual cost as you
  go and STOP if the run would exceed it.
- No production code paths change. Nothing in `src/services/providers/` that the
  live generator calls may be modified.
- No database writes of any kind.
- Do not regenerate pet images. Work from existing outputs.

## Free-edit files
- `src/scripts/upscale-eval.ts` (new)
- `package.json` — the `upscale-eval` script entry only
- `Claude outputs/upscale-eval/**` (new, output only)
- `specs/merch-m0-upscale-eval.md` (this file, if findings change it)

Everything outside this list asks first.

## Out of scope
- Wiring an upscaler into the real generation pipeline. That is M1.
- Anything Shopify, POD, cart, checkout, or credits.
- Changing generation resolution at the source.
- Fixing any identity failure this evaluation uncovers. Report it, do not chase it.
- Automating the identity judgment. A human looks at the images.
- Background removal / transparency for apparel. DTG needs transparent PNG or the
  background prints as a rectangle. Real problem, but it is M1, not M0.
- Per-product cropping, bleed, and compositing. M1.
- Hats and anything embroidered. Ruled out — see parent spec.

## Approach (suggested, not mandatory)
- Locate existing generated images for the 5 pets. If any pet has no usable image on
  disk or in S3, STOP and tell Jake which one rather than substituting another pet.
- Write `src/scripts/upscale-eval.ts` to run each source image through each candidate,
  timing and costing each call, writing output to the folder structure above.
- Run the cheapest candidate on ONE pet first and report the actual cost before
  running the full matrix. That is the spend fork.
- Build REPORT.md from the measured numbers. For the identity pass/fail, describe what
  changed in specific terms — "muzzle narrowed, whisker pads lost definition" — not
  "looks worse."
- Biggest risk: reporting a creative upscaler as a pass because the image is prettier.
  A prettier image of a different dog is a failure. Judge only against the original,
  attribute by attribute, and when uncertain call it a fail.

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
Read specs/merch-m0-upscale-eval.md and execute it. Follow the House rules exactly.
This is an evaluation — no production code changes. Stop and report the measured cost
after the first upscale call, before running the full matrix.
