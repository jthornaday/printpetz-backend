> Evidence log for M0. Image outputs live locally under `Claude outputs/upscale-eval/` and are not committed.

# M0 upscale evaluation — COMPLETE

Run 2026-09-22. **Not complete.** Blocked on a dead fal API key.

## Status

| Step | State |
|---|---|
| Source images for all 5 regression pets | DONE |
| Local Lanczos baseline, 2x/3x/4x | DONE, $0.00 |
| AI upscalers (esrgan, aura-sr, clarity) | **BLOCKED — fal 401** |
| Per-pet identity pass/fail vs AI upscalers | not started |

## Blocker
`npm run upscale-eval -- --probe` fails before spending anything:

```
ApiError: Unauthorized  status 401
body: { detail: 'No user found for Key ID and Secret' }
```

`FAL_API_KEY` in local `.env` parses as id:secret but the **secret half is 31 chars
where fal's format is 32** — the ID half is a valid 36-char UUID, and there is no stray
whitespace, quoting or CR. That is a truncated paste, not a revoked key, and it matches
the 401 body exactly. Re-copy the key from fal.ai/dashboard/keys. Credentials are a
hard gate, so nothing in `.env` was touched.

The OpenAI lane works — the two generations below succeeded on `gpt-image-2.5-flare`.
This is specific to fal.

**Worth checking separately:** the code default provider is `fal`. Local config is not
production config, so this likely says nothing about the live site — but if EB carries
the same stale key, the production fal lane would also be failing.

## Source set
All five pets, all Baseball theme, all confirmed **832x1024** — one variable.

| Pet | Source | Note |
|---|---|---|
| Wizard | bakeoff 2026-09-16 | black cat, coat-colour test |
| Max | bakeoff 2026-09-16 | brand benchmark |
| George | bakeoff 2026-09-16 | muzzle + display name |
| Moses | generated 2026-09-22, $0.0766 | model id 28 (NOT 14 — colour audit reports 14 BROKEN, Display P3) |
| Darla | generated 2026-09-22, $0.0783 | model id 13, only Darla training |

Generation spend: **$0.155**. Upscale spend: **$0.00**. Budget cap $20 untouched.

Moses and Darla were never in the bakeoff matrix, which is why no images existed.
Both were added to `PET_PICKS` in `src/scripts/provider-bakeoff.ts`.

Baseline quality check on both new images: Moses is a caramel golden doodle, correct
anatomy, four limbs, no duplication, "MOSES" on cap and jersey. Darla is fawn with a
grizzled grey muzzle, correct anatomy, "DARLA" on cap and jersey. Both are usable
baselines. Darla's grey muzzle is a particularly good identity trap — a creative
upscaler that "cleans up" an old dog's grey face fails visibly.

## Preliminary finding — Lanczos may be sufficient
15 images generated locally via `sips` at exact target dimensions (2x = 1664x2048,
3x = 2496x3072, 4x = 3328x4096). Cost $0.00, no API, no key.

**Lanczos resampling cannot invent detail.** It is mathematically incapable of
repainting a coat, reshaping a muzzle, or adding a limb. Identity risk is zero by
construction — it is not a judgement call.

A 900x900 crop of Darla's face from the 4x (`_crops/darla-face-4x.png`) — inspected at
100% print resolution — is soft but clean. Fur strands resolve around cheeks and
muzzle. The grizzled grey-white muzzle survives with speckle texture. Nostrils, whisker
pads and eye detail are readable. No artifacts, no haloing, no mush.

Assessment, pending human confirmation:
- **16x20 canvas @150 DPI — likely fine.** Canvas weave hides resampling softness.
- **8x10 poster @300 DPI — soft but plausible** at normal viewing distance.
- **Small goods (mug, coaster, koozie) at 2x — almost certainly fine.**

If a human agrees the Lanczos output is print-acceptable, **the AI upscaler question
becomes optional rather than blocking**, and the identity risk that framed this entire
milestone drops to zero. That would be the cheapest possible outcome for the project.

This is a preliminary read, not the verdict. Confirm by opening
`Darla/lanczos-4x.png` at 100% and comparing to `Darla/original.jpg`.

## CONFIRMED BY PHYSICAL PRINT — 2026-09-22
Jake printed `Darla/Darla-8x10-300dpi.jpg` (2400x3000, true 300 DPI, 2.93x single
Lanczos pass from the 832x1024 original) and reports it **worked**.

This is the first hard evidence in the whole merch effort, and it is real-world, not
a screen judgement.

What it establishes:
- **Plain Lanczos is print-acceptable at 2.93x on paper at 300 DPI.**
- Paper at 300 DPI is the HARDER surface. Canvas weave hides softness; paper does not.
- Identity risk for this path is **zero by construction** — Lanczos cannot repaint a
  coat, reshape a muzzle or add a limb. This is not a judgement call, it is arithmetic.
- **No AI upscaler, no fal key, and no per-image API cost** are required for this tier.

Tier status:
| Tier | Products | Status |
|---|---|---|
| 2x | mug, coaster, pint glass, thermos, koozie, lunch box, pet bowl/tag/collar | implied pass (easier than the confirmed 2.93x) |
| 3x | t-shirt, sweatshirt, hoodie, 8x10 poster, 8x10 framed | **CONFIRMED on paper** |
| 4x | 16x20 canvas, 18x18 pillow, 11x14 framed, pet bandana | still unproven |

## Caveat — house rule not yet satisfied
Workspace CLAUDE.md: "Never declare a generation fix successful off one good image.
Multiple images, multiple pets."

This is **one print, one pet**. Darla is a fawn dog with a grizzled grey muzzle — a
good test, but not the hardest one. Before treating the 3x tier as settled, print:
- **Wizard** — solid black cat. Dark, low-contrast fur is where resampling softness
  shows worst, and coat colour is the #1 historical failure.
- **Moses** — dense curly golden-doodle coat, the highest-frequency texture in the set.

If those two also print acceptably, the 3x tier is genuinely settled.

## Next
1. Print Wizard and Moses at 8x10 to satisfy the multi-pet rule.
2. Test the 4x tier when printer access allows — 16x20 canvas file is already built at
   `Darla/Darla-16x20-canvas-print.jpg`.
3. AI upscalers (fal) are now **optional, not blocking**. Pursue only if a printed 4x
   turns out to be unacceptable. The key is truncated by one character — see below.

## Working tree changes made
- `src/scripts/upscale-eval.ts` — new
- `package.json` — added `upscale-eval` script
- `src/scripts/provider-bakeoff.ts` — added Moses (28) and Darla (13) to PET_PICKS
- `debug-Moses-Baseball.jpg`, `debug-Darla-Baseball.jpg` — written to repo root by
  the bakeoff `--only` mode. Copies live in this folder; the root ones can be deleted.

Nothing committed, nothing pushed.

---

# VERDICT — 2026-09-22

Full matrix ran: 5 pets x 6 upscaler/factor combinations = **30/30 calls succeeded**.
All outputs at correct dimensions. Plus a free local Lanczos baseline at 2x/3x/4x.

## Recommendation

**Use Lanczos for the 2x and 3x tiers. Use aura-sr only if a printed 4x proves too
soft. Do not use clarity. Do not use esrgan on dark-coated pets.**

## Evidence

Fidelity, MAE vs original after downsampling back (0 = identical, scale 0-255):

| Pet | lanczos | aura-sr | esrgan | clarity |
|---|---|---|---|---|
| Wizard | **1.02** | 3.00 | 4.35 | 4.93 |
| Moses | **1.28** | 3.25 | 4.86 | 6.08 |
| George | **1.11** | 2.91 | 4.78 | 5.78 |
| Max | **0.94** | 2.94 | 3.67 | 5.56 |
| Darla | **1.23** | 3.36 | 4.30 | 5.88 |

Ordering is identical across all five pets: lanczos >> aura-sr > esrgan > clarity.
The creative upscaler is the least faithful, as predicted.

Wizard coat colour, mean RGB of a chest-fur patch:

| Variant | R | G | B | drift |
|---|---|---|---|---|
| original | 28.6 | 22.4 | 20.2 | - |
| lanczos | 28.6 | 22.4 | 20.2 | **0.0** |
| clarity | 25.9 | 20.3 | 17.6 | 4.3 |
| aura-sr | 23.6 | 19.6 | 18.3 | 6.0 |
| esrgan | 19.4 | 15.4 | 14.4 | **13.0** |

**No upscaler turns Wizard orange.** R:G:B ratios hold nearly constant, so this is
darkening, not recolouring. The historical failure mode does not reproduce.
esrgan crushes blacks hardest — on a black cat, lost shadow detail IS lost facial
structure, so esrgan is the wrong choice for dark coats specifically.

Speed (avg per image): esrgan 4x 12.7s, aura-sr 4x 13.1s, clarity 4x 31.7s.

## Why Lanczos wins for 2x and 3x

1. **Confirmed on a physical print.** Darla 8x10 at true 300 DPI, 2.93x, printed and
   judged acceptable by Jake. Paper is the harder surface; canvas hides softness.
2. **Zero identity drift, guaranteed by arithmetic.** Lanczos cannot repaint a coat,
   reshape a muzzle or add a limb. Every AI upscaler measurably drifts; this one
   measurably does not (MAE ~1.0, colour drift exactly 0.0).
3. **Zero cost, zero API dependency, zero latency.** No fal key, no per-image charge,
   no rate limit, no provider outage risk. Runs locally in milliseconds.
4. It beat every AI upscaler on fidelity on all five pets, without exception.

The AI upscalers buy sharpness. They cost fidelity. For a product whose single
standard is "the pet is preserved", that is the wrong trade at 2x and 3x — because
Lanczos at those factors has already been proven good enough on paper.

## Tier status

| Tier | Products | Status |
|---|---|---|
| 2x | mug, coaster, pint glass, thermos, koozie, lunch box, pet bowl/tag/collar | **PASS** — easier than the confirmed 2.93x |
| 3x | t-shirt, sweatshirt, hoodie, 8x10 poster, 8x10 framed | **PASS — confirmed on physical prints, multiple pets incl. Wizard** |
| 4x | 16x20 canvas, 18x18 pillow, 11x14 framed, pet bandana | **PASS — confirmed on a physical 16x20 print of Wizard at 3.91x** |
| n/a | hats / embroidery | ruled out, 6 thread colours, $8.95 per unique design |

## MULTI-PET RULE SATISFIED — 2026-09-22
Jake printed the 8x10 set at true 300 DPI and reports **all prints look great**.

That clears the house rule in the workspace CLAUDE.md: "Never declare a fix successful
off one good image. Multiple images, multiple pets." Confirmed across pets including
**Wizard** — solid black cat, the hardest case in the set, where thin bright whiskers
against black fur is the worst possible scenario for any resampling, and where facial
structure lives entirely in shadow detail.

**The 3x tier is now settled by physical evidence, not inference.**

## 4x TIER CONFIRMED — 2026-09-22
Jake printed Wizard at 16x20 (3200x4000 @200 DPI, **3.91x** single Lanczos pass) and
reports it works. That is a larger upscale than the 2.93x that passed at 8x10, on the
hardest pet in the set — solid black cat, thin bright whiskers on black fur, facial
structure living entirely in shadow detail.

**Every tier is now proven on paper. M0 is fully complete.**

The only product ruled out anywhere in the catalog is hats (embroidery, 6 thread
colours, $8.95 per unique design) and 24x36 posters (need 10800px, unreachable).

## Outstanding
None for M0.
2. ~~Multi-pet rule~~ — DONE. All 8x10 prints confirmed good, Wizard included.

## Spend
Generation (Moses + Darla): **$0.155**. Upscaling: 30 fal calls, check dashboard.
Lanczos baseline and all print files: **$0.00**. Budget cap was $20.
