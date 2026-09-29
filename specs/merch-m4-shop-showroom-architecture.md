# Shop / Showroom: architecture proposal

Status: **PROPOSAL. Not approved, not executable yet.** Written by `architect` on
2026-09-26. Once Jake approves the three decisions at the bottom, each milestone
below gets its own short spec with Done-when checks.

> **Numbering collision.** `merch-parent.md` already reserves **M4** for the
> credit refund, and the frontend's `merch-m2a-order-flow.md` calls catalog
> browsing and the cart **M2b**. This document is really **M2b**. It was saved
> under the filename it was asked for. Jake can rename it. Nothing depends on the
> name.

## What Jake asked for (verbatim)
1. "we need the shop accessible and visible in Printpetz.com"
2. "there need to be a showroom so people can see the product"
3. "i want every single item in the shop to show the image their choosing for a product"

In practice: every product tile and product page shows **the customer's chosen
generation on that product**, not a stock photo, and the picture is truthful
about what will print.

---

## What exists today (read from the code, 2026-09-26)

| Piece | Where | State |
|---|---|---|
| Product catalog, prices, variant GIDs, `merchAvailable()` | `printpetz-frontend/src/constants/merch_products.ts` | Works. 7 visible products, pint glass hidden. |
| Cart and checkout | `printpetz-frontend/src/services/shopify/cart.ts` | `createCheckoutForGeneration()` creates **one line** and returns `checkoutUrl`. There is no multi-item cart. |
| Order UI | `printpetz-frontend/src/components/pages/shared/OrderPrintDialog/index.tsx` | Opened from "Order print" in `GenerationPreviewDialog`. A text list of products. This is what Jake is rejecting. |
| Mockup thumbnails | `GenerationPreviewDialog/index.tsx` + `shared/AutoSmartMokup/index.tsx` | Flat CSS overlay onto `mug.png`, `pillow.png`, **`t-shirt.png`**. **We don't sell t-shirts** (apparel is blocked on DTG transparency). The overlay also uses `object-cover` at a hand-tuned offset, so it doesn't show the real print crop. It's misleading today. |
| `/shop` page | `src/pages/shop.tsx`, `src/components/pages/Shop/index.tsx` | Static marketing preview: t-shirt, mug and pillow stock images, plus the line "Physical product ordering is not yet available." Out of date since the first real order. |
| Nav | `src/components/shared/Premium/index.tsx` (`PremiumHeader`) | **No Shop link.** The old `Landing/components/Header.tsx` has one, but the landing page no longer renders that header. This is why Jake says the shop isn't visible. The studio `Sidebar` has only Create and Gallery. |
| Landing FAQ | `src/components/pages/Landing/index.tsx` | Says ordering isn't available yet and lists hats, shirts, water bottles and sweatshirts. Hats are ruled out. Out of date. |
| Print-file builder | `printpetz-backend/src/services/print_file_service.ts` `buildPrintFile()` | This is the only truth about what prints: the treatment, the rembg cutout plus de-halo, the subject-aware crop window, the Lanczos resize, and the mirrored bleed. |
| rembg cache | same file, `CACHE_DIR = <cwd>/Claude outputs/.print-cache` | **Local disk.** On Elastic Beanstalk that's per-instance and wiped on every deploy. This matters for this project (see Risk 1). |
| Webhook → Printful | `src/controllers/shopify_webhook_controller.ts`, `src/services/printful_service.ts` | Works. It trusts the client-supplied `_generation_url` (see Risk 6). |

Note: neither repo has its own `CLAUDE.md`. Only the workspace-root one exists.

---

## Decision 1: how mockups are rendered

### The facts that decide it

**Printful Mockup Generator.** Checked against Printful's own v2 docs on
2026-09-26, section "Throttling and daily file limit":

> "2 requests per minute for new stores; 10 requests per minute for stores with at
> least $10.00 worth of fulfilled orders. Additionally, there is a limit of 20,000
> files that can be generated daily."

- Our store has **$0 fulfilled**. The test order was a draft, and drafts don't
  count. So today the **account-wide limit is 2 requests/minute**.
- Tasks are **asynchronous**. You poll `GET /v2/mockup-tasks?id=` or wait for the
  `mockup_task_finished` webhook. The docs don't publish a latency figure.
  **Unmeasured.** Plan for tens of seconds until M4.0 measures it.
- One v2 task **can take several products** (a `products[]` array using
  `source: "catalog"`, `catalog_variant_ids` and `mockup_style_ids`). So one
  request could in principle cover every product for one image and one treatment.
- Result URLs are under `printful-upload.s3.../tmp/...`. That path means
  temporary. Anything we keep has to be copied to our own S3.
- Printful also publishes **layout templates** with exact print-area geometry
  (`print_area_top/left/width/height`, template image). That's useful to us even
  if we never call the generator at runtime.

**Our own pipeline.** The one step that can take seconds is rembg (4–18 s, per
M3). It's needed for (a) any **cutout** and (b) the subject-aware crop on the
**square/cropped products** (coaster, pillow, can cooler), **even in panel mode**.
Every other step is a sharp resize of an 832x1024 image, which takes
milliseconds.

### Options

| | (a) Printful mockups at runtime | (b) Our own compositing | (c) Our compositing for grid + Printful on detail page |
|---|---|---|---|
| Grid latency | 10s of seconds+, and **queued account-wide at 2/min**. Three shoppers picking an image in the same minute already queue. | Instant for 4:5 products. 4–18 s once per generation for rembg-dependent tiles. | Grid instant. Detail page waits on Printful. |
| Truth about crop and treatment | High, *if* we send it our real print file. | High, *if* the composite is made from our real print file (the design below does this). | High. |
| Photo realism (mug curve, fabric) | Best. | Good for flat products (poster, framed, canvas front, coaster). Acceptable for mug, pillow and can cooler with shading. | Best on detail page. |
| Cost | Free, but rate-limited. Adds an async job, webhook or poller, and an S3 copy. | Static blank photos plus a small backend endpoint. | Both. |
| Failure mode | Printful is slow or down, so the shop shows nothing. | Only rembg can be slow, and only for some tiles. | Detail page falls back to (b). |
| Effort | Medium-high (queue, polling, caching, rate-limit backoff). | Medium. | Highest. |

### Recommendation: (b), built on the print file itself. Printful only for calibration now, (c) later if measurements justify it.

**The core idea: the thing we composite onto the product photo is a shrunken copy
of the actual print file.** The server already has one function that decides
exactly what prints (`buildPrintFile`). We split it into "plan" (which pixels,
which treatment, which crop window, which bleed) and "render" (resize to a target
size). The print file renders the plan at full size. The showroom renders **the
same plan** at about 800 px. Two consequences:

- Crop, cutout, de-halo and canvas bleed in the preview are **the same code path**
  as the print, not a second copy of the maths in TypeScript in the other repo
  that drifts. That's what keeps customers from being misled.
- No AI anywhere in the preview path. Only crop and Lanczos resize, so the preview
  **can't re-stylize the pet**. Pet identity is safe by construction.

The frontend then places that preview onto a **blank product photo** using a
per-product template (quad corners, a shading layer, a mask). It does this with
plain DOM and CSS (`matrix3d` for perspective, `mix-blend-mode: multiply` for
shading, `mask-image` for handles and edges). No canvas, so there are no CORS or
tainting issues with CloudFront images, and it costs no server CPU per page view.
Changing a template doesn't invalidate any cache.

**Printful's role now:** calibration only. In M4.0 and M4.3 we
1. pull Printful's layout templates for each catalog product to get the true
   print-area rectangle, and
2. render the five regression pets through Printful's generator once (about 10
   requests, fine even at 2/min) and put them side by side with our composites.
   A template that places the art where Printful doesn't gets fixed before launch.

**Why not (a):** the account-wide rate limit alone rules it out for a grid. At
2/min, the grid for one shopper can take a minute or more, and a second shopper
waits behind the first. Even at 10/min it's a queue, not a showroom.

**When (c) is worth it:** if calibration shows the mug or can-cooler curvature
misleads customers in a way shading can't fix. The detail page could then request
one Printful mockup for the selected product, treatment and variant, poll it, copy
it to S3 and cache it permanently. Decide after M4.0 measures real latency. Not in
v1.

### Two rules the composite must follow (write them into the component)
1. **Transparent areas show the substrate colour, not the page.** A cutout on a
   white mug is pet-on-white. Never show a checkerboard or the page background
   through it.
2. **Shading can't be allowed to recolour the pet.** Multiply shading darkens.
   Too much of it makes a cream dog look tan, which is the Wizard failure in
   reverse. Cap shading-layer opacity per template, and on the product page
   **always offer an unshaded "Exact print" view** (the flat preview, no product
   photo) captioned "This is exactly what we print."

---

## Decision 2: page structure (IA)

### Routes
| Route | Who | Shows |
|---|---|---|
| `/shop` | Everyone (already a public route) | Image picker strip, treatment toggle, product grid. Every tile is a composite of the chosen image. |
| `/shop/[product]` | Everyone | Large composite, "Exact print" view, alternate angle if a template exists, size variants with prices, treatment toggle, quantity, Buy / Add to cart. |

State lives in the URL: `/shop?generation=123&treatment=panel` and
`/shop/mug_11oz?generation=123&treatment=cutout&variant=15oz`. That makes a link
shareable and the back button work, and the existing dialog can deep-link in.

### What `/shop` shows in each state
| State | Picker | Grid |
|---|---|---|
| Logged out | Hidden. Banner: "Every product shows your pet. Here's Max." plus Create and Sign in CTAs. | Every tile rendered with a **demo pet** (Max, the brand mascot) through the **same pipeline**, labelled "Shown with Max". |
| Logged in, no completed generations | Empty state: "Make your first portrait". Links to /create, or to model training if they have no model. | Same demo pet, same label. |
| Logged in, has generations | Horizontal strip of their completed generations (reuses the `generation_view` query), newest first. Selection comes from `?generation=`, else the newest. | Every tile shows **their** chosen image. Tiles that need rembg show a skeleton ("Fitting your pet to this product…") until ready. We never show a guessed centre-crop in the meantime, because that would be a lie about the crop. |
| `?generation=` isn't theirs, or is gone | Ignore it and fall back to their newest (or the demo). Never show someone else's pet. | |

Requirement 3 says every item shows *their* image. A visitor with no image can't
meet that. The demo pet is the honest stand-in because it demonstrates the
personalization rather than a stock product. This is **decision B** below.

### How the existing order dialog fits
- "Order print" in `GenerationPreviewDialog` becomes **"Shop this image"** and
  links to `/shop?generation=<id>`. The shop replaces the dialog. We don't
  maintain two ordering UIs.
- The t-shirt / mug / pillow thumbnail strip in that dialog is replaced with 3–4
  real composites of products we sell (same component), or removed. Showing a
  t-shirt we can't sell is a live problem today.
- `OrderPrintDialog` and `AutoSmartMockup` are **deleted** only after the new shop
  has been live behind the flag for a while. Deleting needs Jake's go-ahead.

### Layout and navigation
- `/shop` keeps the premium marketing layout (`PremiumHeader`/`PremiumFooter`) for
  everyone, so it looks the same logged in or out. `PremiumHeader` becomes
  auth-aware: "My studio" instead of "Sign in" when there's a session.
- Add **Shop** to `PremiumHeader` (desktop and mobile), `PremiumFooter`, and the
  studio `Sidebar` (third item after Create and Gallery).
- **Gotcha:** `PageWrapper.resolveLayout`, `AuthGuard.isPublicRoute` and the
  "redirect away from public routes" rule all compare `pathname` **exactly**
  (`=== ROUTES.shop`, `publicRoutes.includes`). `/shop/[product]` has pathname
  `/shop/[product]`, so it would fall into the wrong layout and possibly bounce to
  login. They need prefix matching for `/shop`. Also, `src/pages/shop.tsx` moves
  to `src/pages/shop/index.tsx`. Same URL.

### Cart
Today checkout is **one line per checkout**. The shipping tiers ($6.95 under $30,
free at $100+) and `merch-parent.md` ("multi-item carts are where margin lives")
both argue for a real cart. It's a separate PR: keep the Shopify cart id in
localStorage, use `cartLinesAdd` with the same four attributes per line, add a
cart drawer, and keep the empty-line / warnings guard from `cart.ts` on every
mutation. Whether it goes in the launch scope is **decision C**.

---

## Decision 3: data, caching and invalidation

### What's stored where
| Thing | Where | Key | Why |
|---|---|---|---|
| Chosen image | **Nowhere server-side.** URL params, plus localStorage for "last chosen". | — | It's a view choice, not a record. The order carries it on the line item as today. |
| rembg cutout (raw) | S3 | `merch/derived/{srcSha}/rembg-v1.png` | Shared by preview **and** fulfilment. Keyed by source-image hash, so it's correct whichever generation row points at it. |
| Subject bbox | S3 | `merch/derived/{srcSha}/bbox-v1.json` | Cheap to recompute from the cutout, but caching avoids re-reading the PNG. |
| Print previews | S3 via CloudFront | `merch/previews/{srcSha}/{PIPELINE_VERSION}/{productKey}-{treatment}.{jpg\|webp}` | Immutable. Identical plans (poster, framed and mug panels are all an uncropped 4:5) can share one file. The manifest just points several products at one URL. |
| Manifest | S3 | `merch/previews/{srcSha}/{PIPELINE_VERSION}/manifest.json` | One GET answers "what's ready". Per product and treatment: URL, status, and crop notes for the product page ("Cropped to a square around your pet"). |
| Demo pet manifest | Committed to the frontend (`src/constants/merch_demo.ts`), pointing at S3 previews rendered once by a script | — | Logged-out shop makes **zero** backend calls. |
| Blank product photos, templates | Frontend `public/merch/templates/…` + `src/constants/merch_templates.ts` | per product key, **and per variant where the physical product differs** (mug 11/15/20 oz, can cooler regular/slim) | Adding a product is a template row plus an image. |

**No Supabase table or migration.** Deterministic S3 keys plus a manifest are
enough, and that keeps us clear of a production DB change. If order history or
analytics later need a table, that's a separate proposal.

### Cache keys and invalidation
- **`srcSha`** (sha256 of the source image bytes, truncated) is the root key. A
  generation's image never changes, and keying by bytes rather than by generation
  id means a re-uploaded or copied image can't serve a stale preview.
- **`PIPELINE_VERSION`** is a constant in `print_products.ts`. Bump it whenever
  `buildPrintFile` or any product's geometry changes, e.g. if canvas `bleedIn`
  goes to 0 after the double-wrap check. Old previews are orphaned, not
  overwritten, so there's no CloudFront invalidation to manage.
- **Template changes** are frontend-only and need no invalidation.
- **Cleanup:** an S3 lifecycle rule that expires `merch/previews/` after about 90
  days. The `merch/derived/` cutouts stay, because fulfilment needs them. This is
  an AWS config change, so **Jake does it**.
- Deleting a generation leaves its previews on S3 until the lifecycle rule
  removes them. They're as public as the generation image already was (CloudFront,
  unguessable path).

### Backend endpoint
`POST /merch/previews` `{ generationId }` → returns the manifest immediately.
`GET /merch/previews/:generationId` → re-reads it (the frontend polls every ~2 s
while anything is `pending`).

- Behind `verifyToken`, **plus an ownership check**: the generation's `user_id`
  must equal the caller. rembg is a paid call, and this must not become a free
  background-removal API for arbitrary URLs. (The existing
  `/generation/remove-background` already accepts any URL. That's out of scope
  here, but worth knowing.)
- 4:5 panel previews are rendered **synchronously** (milliseconds). rembg-dependent
  entries come back `pending`, and one background job per `srcSha` fills them in.
  That's the same "reply, then work" pattern as the webhook. An in-process map
  dedupes concurrent requests. A duplicate across EB instances costs one extra
  rembg call, which is acceptable.
- Server-side flag `MERCH_PREVIEWS_ENABLED`. When it's off, the route returns 404.

---

## Rollout: phased, flag-gated (merging to `main` deploys to production)

Backend changes are **additive** (new route, new module, cache moved to S3) and
ship first. Frontend changes sit behind **`NEXT_PUBLIC_SHOP_MODE = off | preview | on`**:

- `off`: today's `/shop` page and today's Order dialog. Nothing changes.
- `preview`: the new shop renders only for a browser that has visited
  `/shop?shop_preview=1` (stored in localStorage). Jake tests on the real
  production domain against real Shopify, with nobody else seeing it.
- `on`: the new shop for everyone, nav links shown, and "Order print" becomes
  "Shop this image".

`NEXT_PUBLIC_*` values are baked in at build time, so changing the value in Amplify
means a redeploy. That's why `preview` exists: it avoids flipping the flag
repeatedly.

## M4.0 results — measured 2026-09-26

Scripts: `Claude outputs/m4-measure/` (gitignored). Store 18796047.

**Printful mockup generator (v2 `/v2/mockup-tasks`)**
- Rate limit confirmed from headers: `x-ratelimit-limit: 2`, reset 60 s — 2 tasks per minute, account-wide.
  (General catalog API is separate: 120/min.)
- One task, Darla source, 7 products submitted → **completed in 32.8 s, returned a mockup for 1 product
  (canvas) only**, no failure reason. Treat it as one product per task.
- So one shopper's grid = ≥7 tasks ≈ 3–4 min at 2/min, blocking every other shopper. **Option (a) is ruled out
  by measurement, not just docs.** Our own composites (option b) stand.
- rembg latency not re-measured: it is a fal.ai network call, previously 4–18 s. The "pending" design covers it.

**Print-area templates** pulled for every sold variant (`m40a.json`): template size, print-area rect, placement
names. Pillow (83) and can cooler (764) use `front`/`back` placements, not `default`. These feed M4.3 calibration.

**Print-file spec vs Printful's own printfile (`/mockup-generator/printfiles`)**

| Variant | Ours (px, aspect) | Printful | Verdict |
|---|---|---|---|
| Poster / framed 8x10 | 2400x3000, 0.800 | 3000x2400 (rotatable), cover | match |
| Coaster | 1122x1122 | 1181x1181, cover | match (same aspect) |
| Pillow 18 | 2700x2700 @150 | 2850x2850 @150, cover | match |
| Mug 11/15/20 | 2400x3000 panel | 2700x1050 / 2700x1140 / 3071x1205, **fit** | side placement, as designed; 11 oz verified physically |
| Can cooler regular | 1050x1200, 0.875 | 1260x1528, 0.825, cover | ~6% width lost, upscaled 1.2x — correct the spec |
| **Can cooler slim** | 1050x1200, 0.875 | **1076x2085, 0.516**, cover | **~41% of width cropped away — broken** |
| Canvas 16x20 | 3800x4600 incl. 1.5in bleed | 7800x6600 (26x22in), cover | differs; this is the double-wrap question — physical test |

**Bugs found (outside the shop, fixed separately):**
1. **Every pillow order is rejected by Printful**: product 83 requires `stitch_color` (white/black); we sent none.
   Reproduced with a draft order (400 "stitch_color option missing"); with `white` it is accepted (draft
   178117424, cancelled).
2. Slim can cooler prints a crop of the art (table above).
3. Pillow and cooler get one file with `type: default` — whether the back is blank is unverified (physical test).

## Build status

- **M4.0 done** (results above).
- **M4.1 done**, PR #54: rembg cache in S3 (`merch/derived/{sha}/rembg-v1.png`), `planPrintFile` +
  `renderPreview`. 80/80 print files byte-identical before/after.
- **M4.2 built**: `src/services/merch_preview_service.ts`, `GET /merch/previews/:generationId`
  (owner-only, 404 unless `MERCH_PREVIEWS_ENABLED=true`), `npm run merch-demo`.
  - **Deviation from the proposal:** one idempotent `GET` instead of `POST` + `GET`. Every call
    ensures previews exist and returns the manifest, so polling can land on any instance and a job
    that died is restarted by the next poll.
  - Measured (S3-cached masks): first call ~0.9 s with 5/14 ready (full-scene, mild-crop products);
    the other 9 ready ~7 s later; repeat call 80 ms. A never-seen image adds one rembg call (4-18 s).
  - Each entry carries `trimmed` (share of the art cut away to fit the shape: coaster/pillow 0.19,
    cooler 0.01, 4:5 products 0.02). The shop must tell the customer when it is non-trivial.
  - The manifest is read from S3 directly, never via CloudFront (it changes pending → ready).

## Milestones (each one PR-sized)

| # | Repo | What | Flag | Blocked by |
|---|---|---|---|---|
| **M4.0** | none (scripts / scratch) | **Measure before building.** One Printful v2 mockup task covering all 7 products for Darla's print files: record latency, confirm the 2/min limit via the `X-Ratelimit-*` headers, and pull layout templates (print-area geometry) for each catalog product. Also time rembg on EB-sized hardware. Record the numbers in this file. **Uses the Printful API key, so Jake runs it or approves it.** | — | — |
| **M4.1** | backend | Move the rembg cache from local disk to S3 (`merch/derived/{srcSha}`, local disk kept as L1). Split `buildPrintFile` into `planPrintFile` + `renderPlan(plan, size)`. **Done when the print files for the 5 regression pets × all products are byte-identical before and after**, and a replayed order uses the S3 cutout. | none needed (internal) | — |
| **M4.2** | backend | `/merch/previews` endpoint + manifest + background job + ownership check. `npm run merch-demo` script renders the demo pet's previews. Registering the router in `app.ts` needs a quick OK. | `MERCH_PREVIEWS_ENABLED` | M4.1 |
| **M4.3** | frontend | `merch_templates.ts` + `ProductMockup` component + blank product photos. A flag-gated `/shop/lab` page renders every product × treatment for the 5 regression pets **next to the Printful reference mockups from M4.0**. Calibrate until the placements match. | `preview` only | M4.0, M4.2 |
| **M4.4** | frontend | New `/shop`: picker, treatment toggle, grid, logged-out/empty states, demo pet. Prefix-match fix in `PageWrapper` / `AuthGuard` / `appConstants`. | `SHOP_MODE` | M4.3 |
| **M4.5** | frontend | `/shop/[product]`: large composite, Exact print view, per-variant template, sizes, Buy now → existing `createCheckoutForGeneration` (unchanged contract). | `SHOP_MODE` | M4.4 |
| **M4.6** | frontend | Visibility: Shop in PremiumHeader/Footer/Sidebar, auth-aware header, "Shop this image" in `GenerationPreviewDialog`, replace the t-shirt thumbnail strip, fix the FAQ and "coming later" copy. Then Jake flips `SHOP_MODE=on`. | `SHOP_MODE` | M4.5 |
| **M4.7** | frontend | Multi-item cart (if decision C = yes). | `SHOP_MODE` | M4.5 |
| **M4.8** | frontend | Delete `OrderPrintDialog`, `AutoSmartMokup` and the old Shop component. **Needs Jake's go-ahead (deletion).** | — | M4.6 stable |
| side | backend | Webhook hardening: resolve the image from `_generation_id` server-side (or at least require the CloudFront domain), instead of printing whatever URL a cart supplied. | — | independent |

M4.0 and M4.1 can run in parallel. The customer-visible result (M4.4–M4.6) comes
about 5 PRs in. M4.3 is the one that decides whether it looks good.

## Risks

1. **The preview and the print disagree.** Today the rembg cache lives on EB local
   disk. A preview made on instance A (or before a deploy) and a fulfilment on
   instance B would call rembg twice, and the masks, and so the square crops,
   could differ by a few pixels. **M4.1 fixes this by making S3 the shared cache.**
   The planned byte-identical check makes sure the refactor doesn't change any
   print.
2. **A template misplaces the art.** A customer then thinks more or less of the pet
   is on the product than really is. Mitigations: calibrate against Printful
   templates and mockups (M4.3), and the "Exact print" view.
3. **Unverified physical facts the showroom could overstate:**
   - **Canvas double-wrap** is still open (`merch-m1`). Until the first physical
     canvas is checked, show the **front face only**, not wrap sides built from
     our bleed.
   - **Mug 15/20 oz placement** is unverified (`merch-m3` hardening note).
     Per-variant templates must not claim more than we know. Check the first
     physical mug of each size.
4. **rembg latency and cost.** Square products and all cutouts wait 4–18 s the first
   time an image is chosen. That's handled with skeletons, never a guessed crop.
   Cost is bounded by the ownership check (only your own generations) and by
   caching per image.
5. **Blank product photo licensing.** If we use Printful's template images or
   mockups as the blank backgrounds, check that Printful's terms allow it for
   products they fulfil (they generally do). The fallback is photographing our own
   samples, which also gives better photos.
6. **The webhook trusts client URLs** (existing, not new). Anyone can build a
   Storefront cart with any `_generation_url` and have it printed. Pre-launch that
   costs little (they pay), but it's a content/IP hole. Close it before the store
   password comes off.
7. **Edited looks aren't orderable.** Mascot/Cartoon edits from the image editor
   aren't generation rows (`generation_controller.ts` comment), so they can't
   appear in the picker. That's also true of the dialog today. Worth a product
   decision later, not a blocker.
8. **Mobile weight.** 7 tiles × (blank photo + preview + shading) is about 20
   images. Blank photos are static and small. Previews are about 800 px WebP.
   Lazy-load below the fold.

## What to verify (beyond each milestone's Done-when)
- For each of **Wizard, Moses, George, Max, Darla**: each product × each treatment
  in `/shop/lab`, next to the Printful reference. Wizard on a light product with
  cutout (halo), Wizard's bat on cutout (guillotined prop), George on coaster and
  pillow (muzzle survives the square crop).
- Pick an image, buy it: the Shopify line carries the same four attributes, and
  the Printful draft's file matches the "Exact print" view pixel for pixel (after
  scaling).
- Logged out, logged in with no generations, logged in with generations, a foreign
  `?generation=` id, and a deleted generation.
- `SHOP_MODE=off` build is visually identical to today.
- Shopify's empty-cart guard still fires (warnings / quantity 0) from the new Buy
  button and from the cart.

## Decisions only Jake can make

**A. Mockup approach.** Recommended: our own composites built from the real print
file, with Printful used only to calibrate. The alternative is Printful's
photo-real mockups on the product page, at tens of seconds each and 2 requests/min
account-wide until $10 of real fulfilled orders.

**B. What the shop shows before someone has an image.** Recommended: every product
rendered with Max (demo pet), clearly labelled, plus a Create CTA. Alternatives are
blank product photos, or making the shop logged-in only.

**C. Cart at launch or later.** Recommended: ship Buy-now first (M4.5), cart
(M4.7) before the store password comes off, because shipping tiers make multi-item
orders the profitable ones.

Secondary, can be decided during M4.3: blank photo source (Printful templates vs
our own sample photos), and whether the treatment toggle defaults to Full scene on
every product (current default) or per product.

---

## Decision 1 revisited (2026-09-26)

Written by `architect` after M4.1 (#54), M4.2 (#55) and the UV-calibration experiment
(`Claude outputs/m4-measure/uv/`). This replaces the Decision 1 recommendation above.
Where they conflict, this section wins.

### What changed

1. **The CSS plan has no input.** It needed blank product photos plus hand-made quad
   templates. Printful's `mockup-templates` are flat design-tool guides, and the repo
   has no blank photos. Our own photography is weeks away.
2. **A Printful white render is a blank product photo.** Printful renders a plain-white
   print file through its real photo style (mug style 10423 "Front view") and returns
   the product with real lighting on a transparent background. That's the missing
   input, and it comes from the same renderer Printful uses for its own mockups.
3. **Curvature can't be done in CSS.** `matrix3d` is a flat perspective transform. A mug
   or can cooler needs a per-pixel warp. The experiment does that warp server-side in
   ~70-100 ms, and George/Wizard on the 11 oz mug look photoreal (`mug11-sheet2.jpg`).
4. **Printful at runtime is ruled out by measurement:** 2 tasks/min account-wide, ~33 s
   per task, one product per task.

### The framing mismatch: likely cause (engineer to confirm)

I read the calibration renders directly (`mug11-uv.png`, `mug11-white.png`). The
geometry of the print area is right: our rectangle edges land where Printful's do in
`check-george-side.jpg`. What's wrong is the **decoded position inside the
rectangle**:

| Where on the mug face | True coordinate | Decoded (UV ÷ white) |
|---|---|---|
| Left edge of print, middle row | u = 0 | **u = 0.13** |
| Right edge of print, middle row | u = 1 | ~0.78-0.85 |
| Top edge, middle column | v = 0 | **v = 0.10** |
| Bottom edge | v = 1 | v = 0.96 |

The raw pixel at the left edge is `(31,131,31)` against white `238`. The input there
was `(0,128,0)`. So Printful's renderer **lifts blacks** (0 becomes ~13% of white),
**compresses saturated red** (at the right edge, 255 comes back as 78% of white), and
**bleeds between channels** (blue is 31 where we sent 0). That's a print-simulation
colour transform. It's reasonable for a mockup, but it destroys a colour-coded
position. The decoded range is squeezed to about 0.13-0.8, so our composite shows only
the middle of the art stretched over the whole print area. The pet looks **larger**,
and because the top loses more than the bottom (0.10 against 0.04) it also looks
**higher**. That's exactly the symptom.

This also explains the other results:
- **Re-calibrating at print-file size/DPI changed nothing.** The error is in colour,
  not geometry. `mug11-300-*` decodes to the same numbers.
- **The 39/255 mean diff** mixes this geometry error with a real tone difference: we
  keep the file's blacks, Printful lifts them. It shouldn't be used as the gate (see
  Q3).

**The fix is to stop encoding position in colour.** Encode it in **binary black/white
patterns** (Gray-code stripes). Each pixel is read as "brighter or darker than halfway
between the black and white renders". That comparison survives any tone curve, any
lifted black and any channel crosstalk, because neutral black and white don't get
gamut-mapped. This is standard structured-light calibration. It also answers Q2's
"geometric calibration" option, so Q1 and Q2 collapse into one path.

A quicker patch (subtract a black render, linearise with a grey step wedge) would
remove the lifted black. It would not reliably remove the hue-dependent red
compression. I don't recommend spending time on it.

### Q1. Switch Decision 1? Yes.

**New Decision 1: server-side composites. Each product photo is a Printful white
render. The warp comes from a Gray-code calibration of that same Printful view, and
the art composited is the M4.2 flat preview (the real print plan).** Printful is used
offline only, a few dozen renders per product view, ever.

What survives from the original decision:
- The art is still the **real print plan** (`planPrintFile` → `renderPreview`), so
  crop, cutout and de-halo are the print's code path. No AI touches it, so identity is
  safe by construction.
- Both composite rules still apply, now in the backend compositor. (1) Transparent art
  shows the product surface (cutout = pet on white mug, never the page). (2) Shading
  multiplies but can't recolour: shade = white-render luminance, applied the same to
  every channel, so hue is preserved.
- The **"Exact print" view** (the flat preview, captioned "This is exactly what we
  print") stays mandatory on the product page.

What's dropped: `merch_templates.ts`, the `ProductMockup` quad/CSS component, frontend
blank photos, and the `/shop/lab` calibration page. The frontend just shows an `<img>`.
Calibration becomes an automatic numeric check (Q3) instead of eyeballing in a lab page.

**Where composites fit in M4.2:**

- **When:** render eagerly in the existing background job, straight after each entry's
  flat preview is ready. The flat is already in memory, and a composite is ~100 ms, so
  there's nothing to gain from an on-demand endpoint and it would add a second latency
  path. The synchronous first response still renders **flats only**, so it stays at
  ~0.9 s. Composites always arrive via polling.
- **Event loop:** the warp is a synchronous JS pixel loop. 100 ms blocks per composite ×
  ~20 per image would stall other API requests on that instance. Two cheap
  mitigations, in order:
  1. Precompute each view's per-pixel source index + bilinear weights once at load, so
     the hot loop is a gather-and-multiply. That should be ~10-20 ms (estimate, measure
     it). Also `await setImmediate()` between composites.
  2. If event-loop lag p99 still exceeds ~50 ms under a test burst, move compositing to
     one `worker_thread` before `SHOP_MODE=on`.
- **Manifest shape:** each `PreviewEntry` keeps its flat `url`, which is the Exact
  print, and gains
  `mockups: [{ view, variantKey, status: "ready"|"pending"|"unavailable", url, url480, width, height, calibrationId }]`.
  - `unavailable` means no accepted calibration for that view. The frontend then shows
    the flat preview on the product's substrate colour, never a guessed composite.
  - The grid uses the default variant's `front` view. The product page filters by the
    selected variant (mug 11/15/20 oz look different).
- **Format and size:** WebP with alpha (quality ~80, lossless alpha), cropped to the
  product's opaque bbox plus a small margin, in two sizes: ~1000 px for the detail page
  and 480 px for grid tiles. Measured on Printful's George mug render: **~44 KB** at
  1000 px and **~22 KB** at 480 px (JPEG q85 would be 75/30 KB and lose the
  transparency). About 20 tile images per grid ≈ 0.5 MB, which is fine. The transparent
  background lets the page choose its own backdrop.
- **Cache keys:**
  - Composites live under the existing preview folder:
    `merch/previews/{srcSha}/{version}/mockups/{productKey}-{treatment}-{view}-{variantKey}[-480].webp`.
  - `version` becomes `${PREVIEW_VERSION}-${CAL_SET_HASH}`. `CAL_SET_HASH` is the first
    8 hex characters of a sha256 over the committed calibration registry (see Q3).
  - **So you never bump `PREVIEW_VERSION` for a calibration change.** Changing any
    calibration changes the hash, which gives a fresh folder and manifest. Everything
    re-renders on the next GET. Old files are orphaned for the lifecycle rule.
  - The re-render is cheap: rembg masks stay cached under `merch/derived/`, so it's
    milliseconds of sharp per flat plus the composites. No paid calls.
  - `PREVIEW_VERSION` keeps its current meaning: bump it only when the plan/render
    changes.
  - The committed demo-pet manifest (`merch_demo.ts`) has to be regenerated with
    `npm run merch-demo` after any calibration change. Put that in the calibrate
    script's output as a reminder.
- **Canvas bleed gotcha:** `renderPreview` drops the canvas wrap bleed
  (`print_file_service.ts:252`), but Printful places the **print file**, bleed
  included. A calibration maps photo pixels to print-file coordinates. The compositor
  must convert them to preview coordinates
  (`u_prev = (u·W_print − bleedPx) / (W_print − 2·bleedPx)`), or composite from a
  bleed-inclusive render. The same applies to any future product whose print file isn't
  the preview scaled up.
- **Calibration validity guard:** each calibration records the print-file pixel size
  and aspect it was measured with. Printful's cover/fit placement depends on the
  aspect, so a calibration is only valid for that exact print-file shape. At load, any
  calibration whose recorded size doesn't match the current `PRINT_PRODUCTS` spec is
  treated as `unavailable` and logged. This matters now: can cooler regular and slim
  are both due for print-spec corrections (M4.0 table).

### Q2. If the mismatch isn't fixable quickly: fallbacks, in order

"Every item shows the customer's chosen image" and "stay honest" together rule out one
thing: a composite that puts the art somewhere it won't print. Each fallback keeps the
art correct and gives up realism instead.

1. **Gray-code calibration (above).** It's the primary fix, and also the answer if the
   engineer finds a second cause on top of the colour one.
   - Cost per view: 7 bits per axis (finest stripe ≈ 3 px across a ~400 px print area
     at Printful's 1000 px output) + white + black = **16 renders ≈ 8 min** at 2/min,
     once.
   - Sub-stripe precision comes from fitting a smooth map through the stripe
     transitions. Keep the existing cubic fit if its residual passes Q3. Otherwise use a
     thin-plate/bicubic spline, stored as a dense map.
2. **Parametric models from the print-area boundary.** Use this if Printful renders
   turn out non-deterministic, or stripes don't resolve on some product (pillow seams,
   can-cooler texture).
   - The boundary (white render vs black render) is already correct today.
   - Fit a **homography** for flat fronts (poster, framed, canvas front, coaster).
   - Fit a **cylinder model** for mug and can cooler: axis, radius and panel angle are
     fitted to the two vertical edges and the top/bottom ellipse arcs. The panel's
     angular extent is known from print-area inches ÷ circumference.
   - The pillow gets a homography plus mild radial bulge, or stays flat-only (step 3).
   - This is less exact at the edges but has no colour dependence at all. It's gated by
     the same Q3 threshold.
3. **Per-view honest degrade.** Any view that fails Q3 ships as `unavailable`. Its tile
   shows the **flat Exact print on the product's substrate colour**, next to the white
   render of the blank product at the same scale ("Your design" / "On this product").
   The customer still sees their own image on every item, and nothing claims more
   than we know. **Launch isn't blocked by the hardest product.**
4. **Printful real mockup on the product page, async.** Keep it as an optional "See a
   photo proof" button, not a fallback the grid depends on.
   - At 2/min account-wide and ~33 s per task, it needs a global queue, a webhook or
     poller, a copy to S3, and a permanent cache per (srcSha, product, treatment,
     variant).
   - Worth revisiting only after $10 of fulfilled orders lifts the limit to 10/min.
     Park it as M4.9.

### Q3. Calibration assets: storage, regeneration, automatic acceptance

**Storage: S3, content-addressed. A small registry committed to the repo.**

- **Raw Printful renders** (the Gray-code stack, white, black, acceptance chart):
  `merch/calibration/raw/{viewId}/{runId}/…`. About 4 MB per view, kept for audit and
  never read at runtime.
- **Runtime assets** per calibration:
  `merch/calibration/{calibrationId}/photo.png` (white render, RGBA) and `map.png`
  (16-bit: R = u, G = v, B = coverage). `calibrationId = {viewId}-{sha8(photo+map)}`.
  Roughly 0.5-2 MB per view, ~10 views (estimate).
- **Registry**, committed at `src/constants/merch_calibrations.json`. One row per view:
  - `viewId`, `productKey`, `variantKey`, Printful `product/variant/placement/technique/styleId`
  - the print-file W×H the calibration was measured with
  - `calibrationId`, sha256 of both assets
  - acceptance scores, `accepted: true|false`, date
  - `CAL_SET_HASH` = sha over this file.
- **Why not assets in git:** ~15-20 MB of binaries that get replaced on every
  recalibration would bloat both repos' history and the EB zip.
  - The registry pins exact hashes, so code and calibration still version together. The
    loader checks the sha after download and marks the view `unavailable` on a mismatch.
  - Runtime loads each view once from S3 (the bucket is already used for rembg), keeps
    it in memory (~5 MB per view; the photo can be cropped to the bbox), and keeps a
    local-disk L1 like the rembg cache.
  - Tradeoff: local dev needs AWS credentials. It already does for rembg.

**Regeneration: `npm run merch-calibrate -- <viewId>|all [--check-only]`**
(`src/scripts/merch-calibrate.ts`). It **uses the Printful API key**, so Jake runs it or
approves it, like M4.0.
1. Build the pattern stack at the **exact print-file pixel size and aspect from
   `PRINT_PRODUCTS`**: Gray code (7+7), white, black, plus one acceptance chart. Upload
   to `raw/`.
2. Submit tasks one at a time, honouring `x-ratelimit-*`: sleep until the reset rather
   than retrying into a 429. Include required product options (pillow `stitch_color`).
   - **Worth testing first:** one task with several `mockup_style_ids` for the *same*
     product may return all views at once. That would cut total time proportionally.
     M4.0 only tested several *products*.
3. Decode, fit and write the dense map. Composite the acceptance chart through it and
   score it against Printful's render of the same chart (below).
4. Print a report and write comparison sheets to `Claude outputs/merch-calibration/`:
   ours | Printful | difference, for the chart plus George panel and Wizard cutout.
   Upload the runtime assets. Rewrite the view's registry row. **The registry diff is
   the review artifact in the PR.**
5. Print the reminder: re-run `npm run merch-demo` and update `merch_demo.ts`.

Time: ~8 min per view plus ~2 min of checks. About 10 views ≈ 1.5-2 h wall-clock, once.
Recalibrate only when a print spec changes (the guard in Q1 flags it) or Printful
changes a photo style.

**Automatic acceptance: numeric, and blind to tone.** Mean pixel difference is the
wrong gate: it mixes geometry with Printful's print-simulation colour. The gate
measures **where things land**:

- **Chart:** a high-texture test image (fine checker plus numbered crosshairs) at the
  exact print-file size. It's rendered by Printful as a real print file (the reference)
  and by us through the calibration.
- **Local shift:** split the print area into 32×32 px tiles at Printful's 1000 px
  output. For each tile with enough texture, find the shift (±8 px search) that
  maximises **normalised cross-correlation** between ours and the reference. NCC
  ignores brightness and contrast, so lifted blacks don't count against us.
- **Pass if all three hold:**
  - **p95 tile shift ≤ 1.5 px and max ≤ 3 px** at 1000 px output. That's under 1% of a
    ~400 px mug print area, below what a customer can see.
  - **Coverage IoU ≥ 0.98** between our print-area mask and Printful's (white vs black
    render).
  - The same shift test on **George panel and Wizard cutout** reference renders, with
    thresholds 1.5 px / 3 px on textured tiles. This proves the real print-file path,
    not just the chart.
- **Report only, not gated:** mean absolute difference inside the print area after
  matching Printful's neutral tone curve (measured from the black/white renders). That
  keeps colour drift visible without failing a view for it.
- Today's mug calibration would fail the shift test by a wide margin. The squeeze is
  ~13% of the print width, roughly 50 px. The test does catch the problem we have.

A view that fails is written to the registry with `accepted: false` and ships as
`unavailable` (Q2 step 3). Nothing unaccepted ever reaches a customer.

**Open question for Jake (not blocking):** should composites copy Printful's print
simulation (lifted blacks), or show the file's true blacks as now? Printful's version
may be more honest about sublimation on ceramic. Ours flatters Wizard's black coat.
Recommendation: keep true blacks, record the tone curve anyway, and decide when the
first physical mug arrives, with Wizard as the test.

### Q4. Revised milestones (M4.3 onward)

| # | Repo | What | Done when | Blocked by |
|---|---|---|---|---|
| **M4.3a** | backend | `merch-calibrate` script (Gray code, runner, decode/fit, acceptance, registry) + 11 oz mug front. | Mug 11 oz passes Q3 on chart + George + Wizard. The sheet matches Printful by eye too. **Printful key: Jake runs/approves.** | engineer confirms the colour diagnosis (or the second cause is known) |
| **M4.3b** | backend | Calibrate the rest: poster, framed, canvas **front only**, coaster, pillow (stitch_color white), can cooler regular, mug 15/20 oz. | Every view is `accepted: true`, or `false` with a written reason. | M4.3a. Slim cooler waits for its print-spec fix; cooler regular recalibrates after its ~6% spec correction. |
| **M4.3c** | backend | Compositor in the preview job: view loader + sha check + validity guard, precomputed lookup, WebP 1000/480, `mockups[]` in the manifest, `version = PREVIEW_VERSION-CAL_SET_HASH`, bleed conversion, `unavailable` path. Regenerate the demo. | 5 regression pets × 7 products × 2 treatments render. Event-loop lag measured under a burst of 5 new images. Per-image composite time recorded here. A deliberately corrupted registry sha makes that view `unavailable`, not an error. | M4.3a (can start in parallel with M4.3b) |
| **M4.4** | frontend | New `/shop`: picker, treatment toggle, grid of composites (flat-on-substrate for `unavailable`), logged-out/empty states with demo pet, `trimmed` notice, prefix-match fix. **No templates, no lab page.** | As before. | M4.3c |
| **M4.5** | frontend | `/shop/[product]`: large composite for the chosen variant, **Exact print** tab, sizes, Buy now. | As before. | M4.4 |
| **M4.6** | frontend | Visibility (nav, auth-aware header, "Shop this image", FAQ). Jake flips `SHOP_MODE=on`. | As before. | M4.5 |
| **M4.7** | frontend | Multi-item cart (decision C). | | M4.5 |
| **M4.8** | frontend | Delete `OrderPrintDialog` / `AutoSmartMokup` / old Shop. **Needs Jake's go-ahead.** | | M4.6 stable |
| **M4.9** | both | *Optional, later.* Async Printful photo proof on the product page. | Reconsider at 10/min. | $10 fulfilled |
| side | backend | Slim can cooler print spec (41% cropped), cooler regular aspect, webhook hardening. | | independent. Slim cooler blocks its own calibration. |

**Changes to earlier sections:**
- Decision 3's "Blank product photos, templates → frontend `public/merch/templates`"
  row is replaced by the S3 calibration assets + registry above.
- Risk 2 ("a template misplaces the art") is now caught by the Q3 gate.
- Risk 5 (licensing) now covers Printful-generated renders of products Printful
  fulfils. That's the normal merchant use of their mockups, but confirm in their terms
  before launch.
- Decision **A** for Jake becomes: *approve server-side composites on Printful-rendered
  blank photos, calibrated offline and gated by the numeric check, with per-view flat
  fallback.*

### Addendum (2026-09-26, architect): calibration method superseded

The M4.3a prototype (`Claude outputs/m4-calib/`) replaced Gray code with a **dot grid
+ white + black renders (3 tasks per view, not 16)**. On the 11 oz mug it fits to
0.09 px RMS, and it predicts dots left out of the fit to within 0.21 px. Where the
sections above conflict with this, this wins:
- **Method:** dot grid at the exact print-file size, placed in visible coordinates. Add
  2-3 distinctive marker dots so dot identity doesn't depend on the four corner dots.
  Flat views fit a homography. Mug, can cooler and pillow fit a polynomial.
- **Runtime asset:** the fitted coefficients go in the registry row (committed). S3
  holds only the white render, plus the black render if compositing uses
  `K + (W-K)*art`. No dense `map.png`. The bleed conversion in Q1 doesn't apply,
  because the u,v are already in visible/preview coordinates.
- **Pin `styleId` per view in code.** Don't discover it at run time.
- **Gate:** still the Q3 NCC tile-shift test. Mean-diff (`refs.cjs`) is report-only.
  Add fit gates: all dots matched, or the unmatched ones sit in a documented
  hidden region. RMS ≤ 0.3 px and max ≤ 1 px at 1000 px output.

## M4.3a — photoreal mockups, built 2026-09-26

**Method (what shipped):** per product, three Printful renders through one clean photo style, each at
the product's exact print-file size: plain white (lighting + blank product photo), solid black (print
coverage = lum(white) − lum(black)), and a 13×N dot grid at known positions (geometry). Colour-coded
UV calibration was abandoned: Printful's colour pipeline mixes channels and lifts blacks (39/255 error).
Dots are identified from the grid corners, then every dot is re-identified through the fitted map
(degree ≤ 6 polynomial, x^a·y^b with a,b ≤ 5), with an edge guard against a one-column identity shift.

- `npm run merch-calibrate -- [--render] --dir=<folder> <keys>` → `src/constants/merch_calibrations.json`
  (committed: map coefficients, bbox, style id) + photo and mask PNGs in S3 (content-addressed).
- **Printful caches remote files by URL.** Re-uploading a changed file to the same key made Printful
  render the OLD file (pixel-identical output). All calibration uploads are content-addressed now.
- `src/services/merch_mockup_service.ts`: map precomputed once per product (~1 s incl. asset download),
  then 140–300 ms per mockup, 44–67 KB WebP with alpha.
- The preview job adds `entry.mockup` for calibrated products after the flats; old manifests pick
  mockups up on their next poll. `manifest.complete` tells the shop when to stop polling. A mockup
  failure never removes the flat preview (`mockupFailed` stops retry loops).

**Acceptance gate** (tile-shift NCC vs Printful's own mockup of the REAL print file, 40 px tiles,
±6 px search, sub-pixel; skip flat tiles and 1-D-texture tiles — stripes can't measure shift along
themselves): pass = 95% of tiles ≤ 1.5 px and none > 3 px, for all 5 regression pets.

| Product | Style | Fit (dots, rms) | 5-pet gate, production path |
|---|---|---|---|
| Mug 11 oz | 10423 Front view | 208/208, 0.09 px | 5/5 PASS, worst tile 1.10 px |
| Poster 8×10 | 9114 Transparent | 208/208, 0.02 px | 5/5 PASS, worst 0.75 px |
| Framed 8×10 | 24615 Flat | 208/208, 0.03 px | 5/5 PASS, worst 0.74 px |
| Coaster | 3006 Flat | 169/169, 0.35 px | 5/5 PASS, worst 1.49 px |
| Canvas 16×20 | 9974 Wall | 208/208, 0.02 px (after the 3in-wrap fix, PR #57) | 5/5 PASS, worst 1.25 px |
| Can cooler | 22029 Flat | **rejected**: 137/208 dots, 7 px rms — bottom ~20% of the art sits on the bottom tab | flat preview only |
| Pillow 18×18 | 12675 Default | **rejected**: outer ring of dots lost in the seams | flat preview only |

The gate itself was fixed once: Max on the coaster "failed" on one tile (outfield wall + grass,
horizontal stripes) where shifts of 1 px and 6 px both correlated at 0.999. Visual check: Printful,
prototype and production crops identical. Fix: skip tiles whose gradient structure tensor is
one-directional (λmin/λmax < 0.15), then re-ran every product.

**Coaster honesty note:** the physical coaster's rounded edge hides ~3% of the print per side. The
mockup shows this; the flat "Exact print" view shows the whole file.

**Open before launch:** can cooler and pillow — both lose part of the art on the physical product
(bottom tab, seams). Needs the same print-spec investigation the canvas got.

## Holiday line (2026-09-28): ornaments, cards, shaped products

- **Products:** Metal Christmas Ornament oval (Printful 23135, 525×650 @200), Greeting Card 4×6 portrait
  (14457, 1240×1842 @300 on a rotatable landscape printfile — 5×7 and A5 are EU-only), Ceramic Ornament
  2-Side circle (23133, 954×954 @300).
- **Hanging holes.** Both ornaments have a hole near the top that punches through the print (measured:
  oval hole bottom at v 0.161, ceramic 0.198). Edge-to-edge art put the hole through every regression
  pet's cap and name (oval) or face (ceramic). `PrintProduct.hangSafe` places the art uncropped at 4:5 in
  a box below the hole and fills the face with a blurred continuation of the same image
  (`renderFace` in print_file_service — used by BOTH the print file and the preview). Jake chose this.
- **Ceramic disc is physically 2.76″**, not 3.18″: 6.7% of the file is lost per side and ~41% of the
  file area never prints. It is HIDDEN: its 5-pet mockup gate fails (3/5, p95 up to 2.3 px) and it is
  not in the calibration registry. Needs its own investigation before it ships.
- **Shape-agnostic calibration.** Dots on shaped products are identified by walking the lattice from the
  centre dot; the grid offset is the one that leaves the printed shape centred (ambiguity → reject).
  Rectangular products keep the corner-dot seed; all five existing registry entries reproduced
  bit-for-bit. Dots clipped by the outline are excluded from the fit.
- **5-pet gate (production path):** oval 5/5 (worst 0.81 px), card 5/5 (worst 1.18 px, style 14103
  "Flat 3 / Front" — closed card), ceramic 2/5 (hidden).
- **Card packs:** `packQuantity` on a Shopify→Printful map entry multiplies the printed quantity
  (10-pack × 2 = 20 cards). Pack variant ids still to be added once Jake creates them in Shopify.
- **Old manifests pick up new products**: ensurePreviews adds missing product entries and renders them.

## Can cooler + pillow safe areas (2026-09-28)

`hangSafe` generalised to `PrintProduct.safeArea` (same layout: uncropped 4:5 art in a box, blurred
continuation elsewhere). Measured by mapping each product's print coverage into art coordinates:
- **Can cooler:** full width visible only from v 0.03 to ~0.81; below that just the centre tab (u 0.22–0.78)
  shows — the art's bottom corners (paws) were being lost. `safeArea { top 0.05, bottom 0.21 }`.
- **Pillow:** ~6–8% of the file lost into the seams on every side. `safeArea { top 0.09, bottom 0.09 }`;
  the art is no longer square-cropped (was a 19% trim).
Both now calibrate with the shape-aware method (cooler 187 dots rms 0.07 px, pillow 121 dots rms 0.23 px).
`PREVIEW_VERSION` → v2 so every manifest re-renders these two products.

**Gate note (methodology, decided 2026-09-28):** for safe-area products the pass/fail is judged on tiles
inside the pet-art box. The blurred band is featureless, so tile-shift NCC there is unreliable, and an
offset there doesn't misrepresent the pet. Result: **cooler 5/5, pillow 5/5** on the art box (p95 ≤ 1.06 px,
no art tile > 3 px). All >3 px tiles were in the blur band (pillow side bands u 0.14/0.87 near the seams;
cooler tab at v 0.89), reported here rather than hidden. Every other product's print file is byte-identical.

## Ceramic ornament re-check (2026-09-28)
The ceramic's earlier 2/5 "fail" was judged on the full face. Split per the safe-area gate rule: on the
**pet-art box all 5 pets pass** (p95 1.00 px, max ≤ 1.41 px, 96–104 tiles each); every failing tile was in
the blurred band (p95 up to 4.1, max 8.5 px) — the known featureless-blur weakness. Printful's own renders of
the real print files confirm the hanging hole lands in the blurred band above every pet's cap, and the whole
pet sits uncropped inside the 2.76″ disc (pet ≈ 1.7″ tall). Added to the calibration registry; offered.
