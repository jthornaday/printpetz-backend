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
