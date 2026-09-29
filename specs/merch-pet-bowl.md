# Pet bowl: a personalised wrap-around print (architecture plan)

Status: **plan only, nothing built.** Written 2026-09-28 by `architect`.
Design: Jake chose "B2" (prototype `Claude outputs/m5/bowl-proto.cjs`).
Related: `specs/merch-m4-shop-showroom-architecture.md` (M4.3a mockups, Holiday line, safe areas).

## What we're building

- **Product:** Printful Pet Bowl, catalog **678**. Variants: **16785** (18 oz, $21.92 base) and
  **16786** (32 oz, $24.98 base). These are the live public catalog prices on 2026-09-28. Retail
  will be $42 and $48. Printing is sublimation.
- **Print area:** one wrap, **6496×803 @300 DPI** (21.65×2.68 in, 8.09:1), fill = **fit**.
  Printful's "Front view" shows the middle of the file (x = W/2). The two ends of the wrap meet at
  the back (x = 0 and x = W). **Nothing may cross that seam.**
- **Layout B2:** a white band. On the front, centred on W/2, is a *lockup*: the pet portrait (4:5,
  rounded corners, 700 px tall) followed by the pet's **display name** in navy `#14264f`
  Archivo Black. Single portraits are centred at W/2 ± W/3.
- **Fallback A2** (used when there is no printable name): five portraits evenly spaced at
  W/2 + k·W/5 for k = −2…2. None of them crosses the seam.

This is the first product whose print file holds something other than the image. That's why it
needs more than a new row in `print_products.ts`.

---

## Decision 1: where the name comes from at order time

**Recommendation: look it up on the server. Do not trust a cart attribute.**

`_generation_id` → `generations.model_id` → **`models.pet_name`** (column `pet_name`,
`text NULL`; `IModel.pet_name: string | null` in `src/types/model.ts`).

Why:
- **The cart is built in the customer's browser.** A `_pet_name` attribute could print any text
  under the PrintPetz name. That's the same hole `isOurGenerationUrl` exists to close for images.
  Text can't be allowlisted the way a URL origin can.
- **The preview must match the print.** The shop preview is rendered server-side from the same
  lookup, so the name the customer saw is the name that prints. A cart string gives no such
  guarantee.
- **It uses only `pet_name`.** It must **never** fall back to `models.name`. The generator does
  `pet_name?.trim() || name` and then strips version suffixes ("Max 2" → "Max",
  `getPetDisplayName` in `fal_utils.ts`). That fallback is exactly the "two names" bug if it
  reaches a physical product. `pet_name` is null only on legacy rows (ids 13–15 predate the column,
  per `provider-bakeoff.ts`). Null means A2 (portraits only), not the model name.
- **Bind the id to the URL.** `_generation_id` is client-controlled too. At order time, load the
  generation and **require `generation.image === _generation_url`**. Otherwise a crafted cart could
  pair our image with someone else's generation id and print *their* pet's name. A mismatch is a
  fulfilment failure: logged, replayable, never printed.
- **Deleted pets still print.** `getModelById` filters `is_deleted = false`. A customer who deletes
  a pet after paying must still get the bowl they saw. Add a small
  `getPetNameForPrint(modelId)` in `model_service.ts` that selects `pet_name` and does **not**
  filter deletions. The preview and the order both use it.

Where it runs:
- `fulfillmentFromShopifyOrder` stays synchronous and DB-free. For products with a `band` layout it
  only checks that `generation_id` is a positive integer. If it isn't, it throws
  `UnfulfillableOrderError`. A treatment other than `panel` on a bowl line is **coerced to
  `panel`** with a warning. The customer paid, so print the only design that exists.
- `preparePrintFile` (`printful_service.ts`, runs after the 200) does the lookup and the binding
  check, then calls `buildPrintFile(..., { displayName })`. Failures land in the existing
  `SHOPIFY_FULFILLMENT_FAILED` log, and `npm run replay-order` re-runs the same lookup.
- Add `printedName` to the `[printful-order]` trace log, so a complaint about the wrong name can be
  answered with one grep.
- Optional, customer-facing only: a *visible* line property `Name on bowl: SIR BARKINGTON` (no
  underscore) so it appears in the cart and on the confirmation email. The backend never reads it
  for printing and at most logs a mismatch.

---

## Decision 2: how the layout is expressed and rendered

### A new layout kind on `PrintProduct`, alongside `safeArea`

```ts
band?: {
  portraitAspect: 0.8;          // artAspect() returns this, so planPrintFile's crop window is 4:5
  portraitHeight: 700 / 803;    // fraction of H; corner radius 6% of portrait height
  sideCentres: [-1 / 3, 1 / 3]; // offsets from W/2, fraction of W (B2)
  fallbackCentres: [-0.4, -0.2, 0, 0.2, 0.4]; // A2
  lockup: { gapPx: 60, maxWidthPx: 2400, color: "#14264f",
            maxFontPx: 540, twoLineMaxFontPx: 417, minFontPx: 180, tracking: 0.056 /* em */ };
  seamClearancePx: 75;          // nothing non-white within 0.25in of x=0 / x=W (asserted)
  previewWidth: 2600;           // see Decision 4
  treatments: ["panel"];
}
```

Pixel values are in print-file space (6496×803). The renderer scales them, so a smaller preview is
the same layout. Every position is relative to W and H. If the 32 oz turns out to have a different
printfile (see Risks), it becomes a second row, not new code.

### How the name reaches the renderer

The name travels **in the plan**, because the plan is "everything that decides which pixels print":
- `planPrintFile(input, key, treatment, opts?: { displayName?: string | null })` computes
  `plan.personalization = { lines: string[] | null, fontPx, omitted?: "no_name" | "unsupported_characters" | "too_long" }`.
  The text layout is decided **once, in the plan**, so preview and print can't choose differently.
- `renderFace` gets a `band` branch, `renderBand(plan, width, height)`. It crops each portrait
  through the existing `renderAt` (Lanczos, same window), applies the rounded mask, composites
  the name as SVG **paths**, and puts everything on white.
- `buildPrintFile` and `renderPreview` need no new parameters beyond the plan.
  `buildPrintFile(input, key, treatment, opts)` just forwards `opts`. Its result gains
  `printedName: string | null`.
- Output is JPEG q97 4:4:4 @300 DPI, like every panel product. The band is opaque white.
- Other products ignore `opts`, and their print files stay **byte-identical**. Verify this by
  diffing one file for each existing product.

### Text: turn the name into paths with opentype.js. Do not use librsvg fonts.

**Recommendation:** load `assets/fonts/ArchivoBlack-Regular.ttf` once with `opentype.js` (MIT, pure
JS, no native parts; pin an exact version with `@types/opentype.js`). Lay the name out glyph by
glyph (advance + kerning + tracking), emit `<path d=…>`, and let sharp/librsvg rasterise the path.
librsvg never sees a font.

Why not fontconfig (`FONTCONFIG_FILE` pointing at a bundled `fonts.conf`) or sharp's
`text: { fontfile }`:
- **Silent substitution.** When fontconfig can't find the font, librsvg and Pango quietly swap in
  DejaVu or whatever the EB AMI has. The order ships in the wrong typeface and no error appears.
  opentype.js either loads the file or throws.
- **Measuring.** Auto-fit needs the exact rendered width *before* rendering. opentype.js gives it
  from the font's own metrics. With librsvg you'd have to render, then measure, then retry.
- **Identical on Mac and EB.** Paths rasterise the same everywhere. That keeps "local looks right"
  meaning something (see `CLAUDE.md`: local ≠ production).
- **No escaping problem.** The name never enters the SVG as text, only as numbers in path data. XML
  escaping is moot, though normalisation still applies (below).
- The trade-off, no complex shaping (Arabic, Indic, ligatures), doesn't matter. Archivo Black has
  no such glyphs anyway.

Verified in scratch on 2026-09-28: opentype.js 1.3.4 loads the bundled TTF (upm 1000, cap height
688, 426 glyphs), and an SVG path rendered through the backend's own sharp.

**Shipping the font.** `assets/fonts/` (TTF + `OFL.txt`) exists but is **untracked**. It must be
committed. Resolve it from `path.join(__dirname, "../../assets/fonts/…")` (`lib/services` →
repo root). `public/` already has to ship at the app root (DEPLOY.md), so `assets/` should too, but
the CodeBuild artifact paths are still marked UNCONFIRMED. Load the font at boot and log loudly if
it's missing. A missing font makes the bowl entry fail closed (preview `failed`, order
`SHOPIFY_FULFILLMENT_FAILED`). It must never fall back to another typeface. Fallback plan if a
deploy proves `assets/` doesn't ship: embed the TTF as a base64 TS module, which then compiles into
`lib/`.

### Normalising the name (`printableName(raw)`)

1. `null`, empty, or whitespace → omitted `no_name` → A2.
2. NFC, trim, collapse internal whitespace.
3. Strip emoji and joiners (`\p{Extended_Pictographic}`, `\p{Emoji_Modifier}`, U+FE0F, U+200D).
   So "Max 🐶" prints "MAX".
4. Uppercase (`toLocaleUpperCase("en-US")`), the same as the jersey lettering. Note that
   "McFluff" becomes "MCFLUFF".
5. Every remaining character must have a glyph (`charToGlyphIndex > 0`). Archivo Black covers
   Latin and Latin-Extended plus `' ’ & . -`. It has **no Cyrillic, CJK or emoji** (checked: Ж, 小
   and 🐶 all return 0). If any character is missing, the name is omitted as
   `unsupported_characters` and the bowl uses A2. Never drop letters silently and never print a
   box glyph.
6. Hard cap of 30 characters before measuring. Longer names are omitted as `too_long`.
7. **No version-stripping.** `pet_name` *is* the display name, so a pet called "Agent 99" keeps
   its 99.

### Auto-fit (measured with the real font, name box = 2400 − 560 − 60 = **1780 px**)

1. Try one line at `min(540, fits 1780)`.
2. If that's under 360 px and the name has 2+ words, try the most balanced two-line split at
   `min(417, fit)`. 417 is the size at which two cap-height lines plus a 0.3 em gap fill the 700 px
   portrait height. Use two lines if the font comes out larger. Lines are left-aligned against the
   portrait, and the block is centred on the portrait vertically, measured by cap height.
3. If the result is under 180 px (cap height ≈ 0.41 in), the name is omitted as `too_long` → A2.
4. The lockup is centred on W/2 using its **measured** width. (The prototype assumed 1250 px, but
   "MAX" is really 1410, so the prototype sat 80 px off-centre.)

Measured results:

| Name | Result |
|---|---|
| MAX | 540 px |
| DARLA | 449 |
| MOSES | 427 |
| WIZARD | 377 |
| GEORGE | 357 |
| O’MALLEY | 294 |
| BARKINGTON | 221 |
| SIR BARKINGTON | 2 lines @ 221 |
| PRINCESS BUTTERCUP | 2 lines @ 244 |
| MR. WHISKERS MCFLUFF | 2 lines @ 198 |
| BARKINGTONSHIRE | 151 → **A2** |

Why 2400 px: the lockup spans ±1200 px, which is ±66° around the bowl. Past about ±60° the curve
foreshortens the letters hard. The side portraits' inner edges sit at ±1885 px. **Tune
`maxWidthPx` once the mockup exists.** This is a constant, not a redesign.

---

## Decision 3: preview caching

The bowl preview depends on the image **and** the name. Everything else depends only on the image.

**Recommendation:** keep one manifest per `srcSha`. The bowl stays **one entry** (`pet_bowl/panel`)
that carries a name key and is **replaced in place** when the key changes.

- `PreviewEntry.personalization = { nameKey, lines: string[] | null, omitted?: … }`, where
  `nameKey = sha256(LAYOUT_VERSION + normalised name or "∅").slice(0, 12)`.
- The S3 keys include it: `{base}/pet_bowl-panel-n{nameKey}.jpg` and
  `…-n{nameKey}-mockup-{calId}.webp`. The files stay immutable, so there's no CloudFront
  invalidation. `renderMockupEntry` builds its key from the entry, so it needs the `nameKey` added
  there too.
- `ensurePreviews(source, { displayName })`: if the bowl entry's `nameKey` differs from the
  current one, reset it to `pending`, clear `mockup` and `mockupFailed`, and let the existing job
  render it. `renderEntry` and `finishInBackground` pass `displayName` through.
- Only `band.treatments` entries are created (panel), so there are **no rembg calls for the bowl**.
  The portrait crop is 4:5 from 0.8125, a 1.6% trim, so `needsSubjectAwareCrop` is false and the
  bowl renders on the synchronous fast path. `trimmedShare` comes out at 0.02 because `artAspect`
  returns `portraitAspect`.
- **No `PREVIEW_VERSION` bump.** New products are already appended to old manifests. Every other
  entry is untouched.
- **How the GET gets the name.** `merch_controller.getPreviews` already loads the owned generation.
  Add `getPetNameForPrint(generation.model_id)` and pass it in. That's one more small query per
  poll. It could be cached for the life of the in-process job, but it isn't worth it yet.

Why replace in place rather than add entries or a second manifest:
- The frontend's lookup (`productKey && treatment === "panel"`) keeps working unchanged.
- Names don't change today: there's no rename endpoint for `pet_name`.
- Two generations sharing identical bytes but different pets is not a real case.

If a rename feature is ever added, this still does the right thing: the next poll re-renders.

The frontend reads `personalization.lines` / `omitted` from the manifest for its captions. It does
**not** use `view.model.pet_name`, which is present client-side on generation views but missing
when the shop is opened with `?g=` for an image the picker hasn't loaded.

---

## Decision 4: mockup calibration (style 6558 "Flat / Front")

The M4.3a method works: white, black and dot-grid renders, then a polynomial map and the NCC gate.
The bowl breaks some of its assumptions:

1. **Preview resolution.** `PREVIEW_MAX_EDGE = 800` would make the bowl preview 800×99. The front
   of the photo shows about half the wrap across a few hundred pixels, and at the centre the photo
   needs about 2π·R pixels of preview per full wrap. At 800 px wide the mockup would be *upsampled*
   and the name blurry. Use `band.previewWidth = 2600` (2600×321, still a small JPEG).
2. **The dot grid.** `grid()` gives NX = 13 and NY = 5 for this aspect. Only about 6 columns are
   visible, and they're squeezed together near the edges. That's too few to fit a degree-6
   polynomial in u. Also, the dot radius (1.2% of min(W, H) ≈ 10 px) shrinks to about 4 px on the
   photo. The bowl needs a per-product grid override: about 40 columns × 5 rows (roughly square
   spacing), radius about 3% of H.
3. **Corners are never visible.** The file's corners are at the back. The corner-dot seed can't
   work, so it must use the shape-aware centre-dot lattice walk from the Holiday line. A periodic
   lattice on a cylinder is exactly where "grid position ambiguous" fires, so **put a unique marker
   at (0.5, 0.5)** (a larger or missing dot) to anchor the offset.
4. **Foreshortening at the silhouette.** du/dx grows without limit toward ±90°, where a polynomial
   fits badly. Limit the fit and the mask to the visible, legible range (|u − 0.5| ≤ 0.22). B2 puts
   only the lockup there (|u − 0.5| ≤ 0.185). The side portraits sit at ±120° and never appear in
   the front view.
5. **The gate** follows the safe-area rule: judge NCC tiles **inside the lockup box** only. Plain
   white elsewhere has no texture. Text edges are strong features, but skip one-directional tiles
   (horizontal letter strokes) as the gate already does.
6. **Taper and top-down view.** If the bowl is slightly conical or photographed from above, the
   band shows up as a curved arc and v depends on x. The 2-D polynomial handles that. Just don't
   assume rows are horizontal.
7. `merch-calibrate` `TARGETS` needs `pid 678, vid 16785, placement "default", technique
   "sublimation"`, with `styleId` pinned to **6558**. Uploads are already content-addressed.

If the gate fails, the bowl can ship with the flat preview (like the cooler once did). But an 8:1
strip is a poor shop tile. **Recommend holding the bowl until the mockup passes.**

---

## Build plan (PR-sized; merging to `main` deploys, so each PR is safe on its own)

**PR A — backend: band print file (nothing a customer can reach)**
- `package.json`: `opentype.js` (exact pin) + `@types/opentype.js`. Commit `assets/fonts/` (TTF +
  OFL.txt).
- `src/services/name_text.ts`: font load (boot check), `printableName`, `fitName` (1-/2-line,
  floor), `nameToSvgPaths`.
- `print_products.ts`: `band` type, `pet_bowl` row (21.6533×2.6767 in @300 → exactly 6496×803;
  assert it), and `artAspect` reads `band.portraitAspect`.
- `print_file_service.ts`: `opts` on `planPrintFile`/`buildPrintFile`, `plan.personalization`,
  `renderBand`, seam-clearance assertion (throws), `printedName` in the result.
- `printful_variants.ts`: `pet_bowl` → 16785 / product 678.
- `scripts/print-file.ts`: `--name=`.
- Done when: the build is clean, the test matrix below passes, and existing products' files are
  byte-identical.

**PR B — backend: previews + orders**
- `model_service.getPetNameForPrint`.
- `merch_controller` passes the name.
- `merch_preview_service`: `personalization`/`nameKey`, band treatments only, `previewWidth`,
  mockup key.
- Add `pet_bowl` to `SHOP_PRODUCT_KEYS`.
- Webhook: `generation_id` required for band products, and treatment coerced to panel.
- `printful_service.preparePrintFile`: lookup, id↔URL binding, name, trace log.
- `SHOPIFY_VARIANT_TO_PRINTFUL`: 18 oz → 16785, 32 oz → 16786, once Jake has created the Shopify
  variants.
- `merch-demo`: `--name=` so the logged-out demo shows "MAX".

**PR C — backend: calibration**
- Grid override, centre marker, fit-domain limit, style 6558.
- Run the gate on 5 pets + long name + A2.
- Registry row only if it passes.

**PR D — frontend**
- `merch_products.ts` row (`pet_bowl`, 18 oz $42 / 32 oz $48, GIDs from the Storefront query),
  **`hidden: true` until Jake flips it**.
- `types/merch.ts`: `personalization`.
- Showroom dialog captions: "Printed name: SIR BARKINGTON"; "Prints with portraits only — {reason}";
  "The print wraps all the way round; the ends meet at the back."
- "Exact print" styling for a strip that's 8 times wider than tall.
- `merch_demo.ts` bowl entry.
- `cart.ts` needs no change: it already sends `_generation_id`. The optional visible "Name on bowl"
  property would go here.

**Jake-only steps:**
- Create the Shopify product and its two variants (no POD app, per the merch-provider plan).
- Commit, push and merge each PR.
- Approve a physical sample.

## Test plan

Automated script (no test runner exists). For each of **Wizard, Moses, George, Max, Darla**, using
their real `pet_name`, plus overrides:

- **Names to run:** "Sir Barkington", "Princess Buttercup", "Mr. Whiskers McFluff",
  "Barkingtonshire" (→ A2), "Zoë", "José", "O'Malley", "Max 🐶" (→ MAX), "Мишка" (→ A2),
  `null`, `"   "`, a 60-character string (→ A2), `<b>&amp;</b>` (letters print literally or go to
  A2; no injection).
- **Assert on each file:**
  - 6496×803, 300 DPI, JPEG.
  - Every pixel within 75 px of x = 0 and x = W−1 is white (seam).
  - The lockup's bounding box is centred on W/2 within 2 px and is at most 2400 px wide.
  - Navy pixels are present exactly when a name is printed.
  - The downscaled print file matches the preview (mean abs diff below a small threshold).
  - The other 10 products' files are byte-identical to before.
- **Printful:**
  - A **draft** order via `replay-order` for 18 oz and 32 oz: file status `ok`, no resolution
    warning, and Printful's own mockup of the real file matches ours.
  - A Shopify `test: true` order stays a draft.
- **Webhook cases:**
  - Missing `generation_id` → unfulfillable (200 + log).
  - Mismatched id and URL → fulfilment failed, nothing created.
  - Soft-deleted model → still prints its name.
  - Legacy `pet_name` null → A2.
- **Physical:** one 18 oz sample of George, whose name is long enough to shrink. Check navy
  sublimation colour, legibility at 357 px, the seam, and that portrait identity survives
  sublimation on a curve.

## Risks

1. **The 32 oz printfile is unverified.** It's a larger bowl, and Printful often gives each size its
   own printfile. Check `/mockup-generator/printfiles/678` for 16786 **before PR A**. If it differs,
   it needs its own row and a variant→size mapping (the same problem as the can cooler slim).
   `fill = fit` would letterbox a mismatched file rather than fail.
2. **Font not shipping** (`assets/` untracked; artifact contents unconfirmed). Mitigated by the boot
   check and failing closed. The base64 embed is the fallback.
3. **Legibility of long names on the curve.** The lockup is off-centre by design (portrait left,
   name right). Judge this from the mockup and the physical sample, and tune `maxWidthPx`.
4. **Calibration may fail on a cylinder.** Then either ship the flat strip or hold (recommended:
   hold).
5. **Free-text names.** `pet_name` has no length limit (frontend `required` only; backend
   `min(1)`) and no content check. That means profanity or brand names under our label, and
   Printful may refuse. Consider a max length (~20) at pet creation. That's a separate small change.
6. **The two-names rule.** Any future "helpful" fallback to `models.name` reintroduces a shipped
   bug. Keep `getPetNameForPrint` the single source, and comment why.
7. **Replays and Printful's URL cache.** Order print files are keyed by order + line index. If a
   replay ever re-uploads a *different* bowl file (the name changed), Printful may use the old one.
   Cheap hardening: add a content hash to the key.

## Decisions only Jake can make

1. **Names that are too long or can't be printed** (e.g. "Barkingtonshire", Cyrillic): print A2
   with a note shown before purchase (recommended), block purchase, or print below the 180 px
   floor.
2. **Uppercase** (matches the jerseys and the prototype) vs. keeping the owner's casing.
3. **Hold the bowl until the mockup passes** (recommended) vs. launch with the flat strip.
4. **A physical sample** (~$22 plus shipping) before selling.
5. **Optional visible "Name on bowl" cart line** (studio-manager may have a view).
6. **A pet-name length cap at creation** (a frontend + backend validation change).
