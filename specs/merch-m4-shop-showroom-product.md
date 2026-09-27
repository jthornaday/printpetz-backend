# Shop / Showroom: product spec (what the customer sees)

Status: **PROPOSAL.** Written by `studio-manager` on 2026-09-26. Not executable
until Jake answers the decisions in section 1.

Companion to `specs/merch-m4-shop-showroom-architecture.md` (architect: HOW mockups
are rendered, routes, caching, milestones M4.0-M4.8). This file owns WHAT the
customer experiences and what "good" looks like. Where the two overlap (routes,
states, the `?generation=` param, the `SHOP_MODE` flag) this file uses the
architect's names on purpose. If they disagree, raise it; don't pick one silently.

> **Numbering.** `merch-parent.md` reserves M4 for the credit refund, and
> `printpetz-frontend/specs/merch-m2a-order-flow.md` calls the catalog and cart
> **M2b**. This is really M2b. Saved under the name it was asked for.

## The standard
**Pet identity is preserved. Everything else is negotiable** (root `CLAUDE.md`).
In the shop that means: the pet on every tile is the exact pixels of the
customer's generation, cropped exactly as it will print. No filter, no
"enhance", no re-generation, no crop the printer won't also make.

Our advantage over the big pet-portrait brands is that the customer sees the
finished art **before** paying, instantly (section 7). That advantage only holds if
the mockup is honest. A pretty mockup that doesn't match the parcel undoes it.

---

## 0. What the customer sees today (audited 2026-09-26, code on `main`)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| 1 | **There's no link to /shop anywhere.** Owner requirement 1 fails. | `PremiumHeader`/`PremiumFooter` (`src/components/shared/Premium/index.tsx`) have no Shop link. The studio header and Sidebar don't either. `Landing/components/Header.tsx` has one, but nothing renders it. | Nobody can find the shop. |
| 2 | `/shop` says "Physical product ordering is not yet available" and shows a **t-shirt** (we don't sell apparel). | `src/components/pages/Shop/index.tsx` | False since the first real order on 2026-09-26. |
| 3 | Landing FAQ promises "shirts, hats, coffee mugs, water bottles, sweatshirts". | `src/components/pages/Landing/index.tsx:23` | Hats are ruled out. Shirts and sweatshirts are blocked. Water bottles aren't in the catalog. |
| 4 | The order dialog says **"We print the artwork exactly as you see it here"**, then shows the uncropped full scene at 128 px tall, for every product and both treatments. | `OrderPrintDialog/index.tsx` | False for coaster, pillow and can cooler (cropped) and for every cutout (background removed). |
| 5 | The gallery preview dialog shows the pet on a **t-shirt** mockup. | `GenerationPreviewDialog/index.tsx:19,38` | Advertises a product nobody can buy. |
| 6 | Ordering is one product per checkout. There's no cart. | `services/shopify/cart.ts` (single `cartCreate`) | "Free shipping over $100" is almost unreachable. No single product costs $100. |

Items 2-5 are honesty problems that are **live now**, whatever happens with the new
shop. They're cheap to fix and belong in the first frontend PR (section 9).

---

## 1. Decisions only Jake can make

1. **Guarantee and returns promise.** Every competitor shows one prominently
   (section 7). Printful covers **misprints, damage and defects only**, reported
   within 30 days, and **never** buyer's remorse. So anything wider than that is
   paid for by us. Options:
   - (a) Printful-matching: "Damaged or misprinted? We'll reprint it free."
   - (b) **Recommended:** (a) plus "**Doesn't look like your pet?** Tell us within
     30 days and we'll reprint it." This matches our one standard and costs one
     reprint (roughly $6-30 landed) in the rare case our honesty rules fail.
   - (c) Crown & Paw-style "don't like it, we'll redo it, no questions asked."
     Generous and open-ended.
2. **What logged-out visitors see, and whether it's for sale.** The recommendation
   agrees with architect decision B: every tile shows **Max** on the product,
   labelled "Shown with Max, our mascot." Still to decide:
   - Is Max merch **buyable** (brand merch), or **display-only** with a CTA?
     Recommended: display-only for v1. The shop sells *your* pet, and a Max mug
     in the cart muddies that.
   - **Which Max image(s).** Pick 1-3 finished Max generations that pass the
     identity checklist on every product (Max has rendered off-center in mockups
     before, per frontend `CLAUDE.md`). Recommended: one baseball and one
     astronaut, so the visitor sees themes.
3. **Cart before the password comes off, or later.** The architect proposes
   Buy-now first and the cart before launch. **I'd make the cart a launch
   blocker.** Our shipping tiers only pay off on multi-item orders ($6.95 on a
   $25 mug is a 28% surcharge, the kind of thing that makes people abandon a
   cart). The parent spec says margin lives in multi-item carts. And advertising
   free shipping at $100 with no way to combine items is borderline misleading.

Secondary, can be decided during build:
- Default treatment. Recommended: **Full scene** on every tile (it's the thing
  they chose, and it needs no rembg wait). Offer Cut out on the product page only.
- The free-shipping threshold is $100. Crown & Paw's is $75. Worth revisiting
  once real order data exists; not a launch question.
- Whether to show the credit refund ("the credits for this image come back when
  you order it"). **Only once M4-credit-refund is built.** Don't advertise it
  before then.

---

## 2. Customer journeys

The three states map to the architect's state table. The rule for every state is
the same: **every product tile shows a real image on that product, never a blank
product photo, never a t-shirt.**

### (a) New visitor, no pet yet, lands on /shop
Entry points: the Shop link in the header (desktop and mobile menu), the footer,
the landing page, search, and shared links.

1. **Above the fold (hero):** headline plus Max on the hero product (framed print
   or canvas: wall art shows off the art best and has the highest price).
   Suggested copy: **"Your pet, on everything."** Sub: "Every product below shows
   Max, our mascot. Make your pet's portrait and they'll show yours instead."
2. **Primary CTA:** "Create my pet" → `/signup` (or `/create` if already signed
   in). **Secondary:** "Already have portraits? Sign in" → `/login`, returning to
   `/shop` afterwards.
3. **Grid:** all 7 products with Max, each labelled "Shown with Max". Price,
   sizes, and "View" on each.
4. **Product page:** the full page works (angles, sizes, price, shipping). The buy
   button is replaced by "Put your pet on this" → signup. Per decision 2, this
   becomes "Add to cart" if Max merch is buyable.
5. After signup and their first generation, a banner on `/create` or in Gallery,
   "See it on products →", links to `/shop?generation=<id>`.

Logged in but no completed generations: same as (a), except the CTA is "Make
their first portrait" → `/create`, or model training if they have no model yet.

### (b) Logged-in user with generations
1. Lands on `/shop` from the header, sidebar or footer. Default image: the one in
   `?generation=`, else the last one they chose (localStorage), else their newest
   completed generation.
2. **"Your image" bar**, pinned below the header: a thumbnail of the chosen image,
   the pet's display name and theme ("MAX · Baseball"), and a **Change image**
   button.
3. Change image opens a picker (a bottom sheet on mobile, a panel on desktop):
   - Only **completed** generations with an image. Never pending or errored ones.
   - Grouped by pet (model), newest first. The pet name is the header.
   - Tap to select. The picker closes, and **every tile and the hero update**.
   - Also has a "Make a new one" link → `/create`.
4. Tiles update to the new image. Tiles that need a subject-aware crop or cutout
   (coaster, pillow, can cooler) show a labelled skeleton, "Fitting [Name] to this
   product…", until the real crop is ready. **Never a guessed center-crop** (see
   honesty rule H2).
5. Open a product → product page (section 4) → choose size and treatment → Add to
   cart → keep shopping, or pick another image and add more → cart → Shopify
   checkout.
6. The URL always reflects the image, product, treatment and size, so Back works
   and a link can be shared. A link opened by a different user falls back to that
   user's own image, or Max. **Never someone else's pet.**

### (c) Coming from a specific generation (Gallery preview, Create results)
Today "Order print" lives in the Gallery preview dialog (`GenerationPreviewDialog`).
Inline results on Create are on the unmerged branch
`fix/create-page-selected-model-and-inline-results`. Both entry points behave the
same way:

1. The button reads **"Shop this image"** (replacing "Order print" and the text-list
   dialog).
2. It goes to `/shop?generation=<id>`. The image bar shows that image, and the
   hero shows it on the framed print.
3. Optional shortcut: under the image, a row of 3 small real mockups (framed, mug,
   canvas), each linking straight to that product page with the image already
   chosen. This replaces the t-shirt strip in the preview dialog.
4. After checkout, "Continue shopping" and the logo in Shopify checkout lead back
   to `printpetz.com/shop`, **not** `shop.printpetz.com` (launch blocker L3).

---

## 3. Showroom page (`/shop`)

**Layout: hero plus grid.** A featured-only carousel hides products. A plain grid
with no hero wastes the most emotional moment.

- **Hero (1 product):** the chosen image on the framed 8x10, large. Next to it:
  "Your image" bar, Change image, and a one-line promise: "What you see is what we
  print."
- **Grid (7 tiles),** in this order (wall art first, because it has the highest
  price and shows the art best): Framed 8x10 · Canvas 16x20 · Print 8x10 · Mug ·
  Pillow 18x18 · Coaster · Can Cooler. With only 7 products, no filters or
  categories are needed.
- **The pint glass never appears** while `hidden: true`.
- **Trust strip** under the grid: shipping tiers, turnaround, and the guarantee
  (decision 1).

**Each tile shows:**
- The customer's chosen image on the product (the architect's composite), in the
  **Full scene** treatment by default.
- Product name and one factual line (the `blurb`, corrected per H6).
- Price: "$25" or "from $25" if sizes differ, **pulled from Shopify at load**, or
  from `merch_products.ts` with a check that the two match (acceptance A9).
- Sizes as text: "11 · 15 · 20 oz", "Regular · Slim".
- The whole tile is the link. No hover-only information, because it has to work
  on touch.

**Switching the image:** one action updates the hero, all 7 tiles, and the image
bar. Tiles that need no rembg (both 8x10s, canvas, mug) update in under 1 s. Tiles
that do show a skeleton with the pet's name. The page must not jump (fixed tile
aspect ratios).

**Mobile (iPhone Safari is Jake's primary device, and the page has compressed
horizontally before):**
- A **2-column grid**. The hero is full width.
- The image bar stays pinned and compact (40 px thumbnail, name, "Change").
- The picker is a bottom sheet with 3 columns of thumbnails and pet-group headers,
  and it closes on select.
- No horizontal scroll at 375 px. Tap targets are at least 44 px.
- Only above-the-fold tiles load first. The rest lazy-load.

---

## 4. Product page (`/shop/[product]`)

A full page, not a dialog (shareable, and Back works).

**Image gallery, in this order:**
1. **On the product:** their image on the product, front view.
2. **Second angle, only where it's true:** mug handle side / opposite side;
   framed at an angle; canvas at an angle **front face only until the double-wrap
   check passes** (U1); pillow back **only as it will really arrive** (U3).
3. **Scale shot:** the product next to something everyone knows the size of (a
   hand, a mug on a desk, a 16x20 on a wall above a sofa). See H4.
4. **"Exact print" view:** the flat print file preview (the same plan as the print
   file, per the architect), captioned "This is exactly what we print." For
   cropped products, a thin outline shows what the crop removed from their
   original.
5. Later: a **real photo** of a physical sample (Jake has physical prints from
   M0). Real photos are the strongest trust signal competitors use.

**Controls:**
- **Change image** (the same picker). Everything on the page updates.
- **Size** (mug 11/15/20 oz, can cooler Regular/Slim). The price updates. The
  mockup updates **only** when a verified per-size template exists (U2). Otherwise
  keep the 11 oz mockup and state the size in text.
- **Style:** Full scene / Cut out, with a one-line explanation. Cut out shows the
  **real** cutout result (never a CSS approximation) on the product's real base
  color (white).
- Quantity. **Add to cart** (primary). Price on the button.

**Info blocks (short, collapsed on mobile):**
- **What's included:** plain physical facts from Printful's product page, e.g.
  "Black frame, ready to hang, hanging hardware included" **only if Printful's
  page says so** (see H6).
- **Size and print area:** real dimensions ("Printed area 3.74 × 3.74 in";
  "16 × 20 in canvas, 1.5 in deep" if true). For cropped products: "Cropped to a
  square around [Name]."
- **Shipping and turnaround:** "Made to order in 2-5 business days, then 3-4
  business days to ship in the US." Our tiers: under $30 $6.95 · $30-59.99 $9.95 ·
  $60-99.99 $12.95 · **$100+ free**. (Printful's stated times, 2026-09-26. Confirm
  which destinations the shipping profile covers before saying "US only".)
- **Returns:** draft for option (b) in decision 1: "Every piece is printed just
  for you, so we can't take returns for a change of mind. If it arrives damaged or
  misprinted, or it doesn't look like your pet did on screen, email us a photo
  within 30 days and we'll reprint it free."
- Checkout note: "Secure checkout by Shopify."

**Cart (decision 3):** a drawer showing each line with **its own image thumbnail
on the product**, size, style and price, plus a free-shipping progress line ("$21
away from free shipping"). Lines with different images can sit side by side.
Each line carries its own four attributes (`_generation_url`, `_generation_id`,
`_product_key`, `_treatment`). The empty-line guard from `cart.ts` applies to every
add.

---

## 5. Honesty rules (non-negotiable)

- **H1. Same pixels, same crop.** The pet in every mockup and in the Exact print
  view comes from the same plan as the print file. No filters, tints, sharpening,
  AI enhancement or re-generation. Shading on curved products may darken
  highlights, but **must not change the coat color** (Wizard stays black, a cream
  dog doesn't turn tan).
- **H2. No guessed crops.** Until the real subject-aware crop is ready, show a
  skeleton, never a CSS center-crop. A wrong placeholder is worse than a loading
  state.
- **H3. Cutout means pet-on-white.** Transparent areas show the product's real
  base color. No checkerboard, no page background. If rembg guillotines a prop
  (Wizard's bat) or leaves a halo, the mockup **shows** that defect. It doesn't
  hide it.
- **H4. Honest scale.** The coaster is 3.74 in, the size of a drink's base, and
  must never look like a trivet. The canvas is 16x20 and shouldn't be shown
  poster-sized against a small wall. Each scale shot uses a reference object at
  true relative size. Tiles are all the same size, so each tile's product photo
  must still read at its true scale (a hand or a mug in frame for small items).
- **H5. Print area is what Printful prints.** Per product:

| Product | Crop from their 4:5 image | Mockup must show | Unverified |
|---|---|---|---|
| Print 8x10 | none | full image, edge to edge | whether Printful adds a white border |
| Framed 8x10 | none | full image. The frame lip hides a sliver of each edge | how much the lip covers |
| Canvas 16x20 | none on the face. 1.5 in mirrored bleed wraps the sides | front face; sides only after U1 | **U1: double-wrap** |
| Mug 11/15/20 oz | none. Scaled to fit on **one side** (side placement, **not a wrap**) | pet on one side, the rest of the mug white, handle position as the real mug | **U2: which side, printed size, 15/20 oz placement** |
| Coaster | square: about **19% of the height removed**, aimed at the pet | square crop, 3.74 in | — |
| Can cooler Regular/Slim | about **7% of the height removed**, aimed at the pet | cropped art on the cooler | **U4: does Slim print the same area** |
| Pillow 18x18 | square: about **19% of the height removed**, aimed at the pet | front as cropped | **U3: what the back looks like** |

- **H6. Copy states only verified facts.** "Museum-matte" and "insert included"
  must match Printful's wording for the exact variant. Drop anything not
  confirmed. No "free shipping" claim without the threshold next to it.
- **H7. No unsellable products anywhere.** No t-shirts, hats or water bottles on
  any page, FAQ or mockup until they're orderable.
- **H8. The display name stays visible.** If the generation shows the pet's name
  (e.g. on a jersey), no crop may cut it off. The George test covers this.

---

## 6. Unknowns to verify on physical product (needs real money: Jake's yes)

Real orders are the only proof for these. **Estimated cost: about $110-140** if
placed as one multi-item order to one address (canvas $28.56, framed $20.76,
pillow $16.60, 15 oz mug $8.11, 20 oz mug $9.69, slim cooler $3.49, coaster $5.55,
plus shipping). Use one regression pet per item, and photograph each next to its
mockup.

- **U1** Canvas: is the visible face cropped tighter than the mockup (Printful
  wrapping on top of our bleed)? If so, `bleedIn: 0` and bump the preview version.
- **U2** Mugs: which side the pet is on relative to the handle, and its printed
  width and height, for 11, 15 and 20 oz. Update the templates from the photos.
- **U3** Pillow: is the back printed, blank, or white?
- **U4** Can cooler Slim: the same print area as Regular?
- Framed: the lip coverage. Print: border yes/no.

---

## 7. Market check: how comparable sites present personalized merch

| Site | What they do | So what for us |
|---|---|---|
| **Crown & Paw** ([home](https://www.crownandpaw.com/), [product page](https://crownandpaw.com/products/the-general-custom-pet-poster)) | Hero shows a real customer's pet beside its portrait. 25+ gallery images per product (lifestyle, close-ups, size comparisons). "Free proofs + revisions", with a proof in 1-2 days after ordering. "Rated 4.8 from 58K+ reviews". "Free shipping orders $75+" with a "$X away" nudge. "Redo and replace your item, no questions asked." Size and frame dropdowns. Upload now or later. | **Minimum to match:** a guarantee, the free-shipping progress line, and at least 3-4 images per product including scale. **Where we win:** they make customers wait 1-2 days for a proof. We show the finished art on the product instantly. |
| **West & Willow** ([home](https://www.westandwillow.com/)) | Illustrated sample pets. "4.9 / 5 from 22233 reviews". **"We do not offer artwork previews or proofs."** "FREE Mug with portrait purchase" bundle. | People pay without seeing the art. Our instant, true preview is a real edge, so say it. The mug-with-wall-art bundle is a proven way to raise order size (later). |
| **PugMug** ([home](https://www.pugmug.ai/), [pillow page](https://www.pugmug.ai/products/premium_pillow)), the **closest competitor**: AI pet portraits to merch | $5.99 for 20 portraits, which comes back as store credit. Product pages show a **sample cat, not your portrait**. Front and back pillow views. "Happiness Guarantee". "Takes only 30 minutes". | Their business model is nearly ours. They don't put the customer's own pet on every product page, so doing it well is our clearest differentiator. They show the pillow back, so we must too (U3). |
| **Shutterfly** ([mug FAQ](https://www.shutterfly.com/ideas/shutterfly-photo-mugs-guide-common-faqs/)) | "Preview your mug… then place your order". "100% happiness guaranteed". Shipping from 6-10 to 1-2 business days. Low-resolution warnings in the editor. | Customers expect a live preview of their own photo. We don't need resolution warnings (every tier is proven on physical prints). |
| **Zazzle** ([help: personalizing on the product page](https://help.zazzle.com/hc/en-us/articles/28113286236951-Personalizing-Customizing-Your-Product-Using-Templates-on-the-Product-Page)) | The preview updates live as the image changes, and one design carries across 1,000+ products. | This is the "change image, everything updates" pattern. It's the baseline expectation, not a nice-to-have. |

Fulfilment facts used above: Printful production takes 2-5 business days, then
standard US shipping takes 3-4 business days
([printful.com/shipping](https://www.printful.com/shipping)). Misprint, damage and
defect claims must be made within 30 days, and there are no buyer's-remorse
returns ([Printful help](https://help.printful.com/hc/en-us/articles/360014006840-How-are-returns-handled-for-quality-issues-vs-customer-change-of-mind)).

---

## 8. Acceptance criteria (testable)

Visibility
- **A1** "Shop" appears in the header on landing, `/shop`, `/create` and
  `/history`, on desktop **and** in the mobile menu, and in the footer. One tap
  reaches `/shop` from each.
- **A2** No page, FAQ or dialog mentions t-shirts, hats, water bottles or "ordering
  not yet available" (grep plus a visual check).

Showroom
- **A3** Logged out: the hero and all 7 tiles show Max on the product, labelled
  "Shown with Max". No blank product photos. The CTA goes to signup.
- **A4** Logged in with generations: all 7 tiles and the hero show the chosen
  generation. Changing the image updates every one of them with no reload. The 4:5
  products update in under 1 s. Cropped products show a named skeleton and then
  the real crop, never a center-crop placeholder.
- **A5** The picker lists only completed generations, grouped by pet, newest
  first. Pending and errored generations are absent.
- **A6** `/shop?generation=<someone else's id>` shows the viewer's own newest image
  (or Max), never the other user's pet.
- **A7** "Shop this image" from Gallery lands on `/shop` with that image selected.
- **A8** The pint glass appears nowhere.

Product page and checkout
- **A9** Every displayed price equals the price in Shopify checkout for that
  variant (check all 10 visible variants).
- **A10** The **Exact print** view matches the Printful draft's print file for the
  same (image, product, treatment): no edge off by more than 2% of that dimension
  (checked with an overlay).
- **A11** Changing size changes the price and the variant sent to checkout. A
  20 oz order reaches Printful as variant 16586 (needs PR #53).
- **A12** A cart with 3 lines from 2 different images produces a Shopify order in
  which each line carries its own four attributes. **Verified in Shopify admin on a
  test-mode order**, not by reading code.
- **A13** The free-shipping line is correct at $99.99 (not free) and $100.00
  (free).
- **A14** Shipping, turnaround and returns text appears on every product page and
  matches the decision 1 wording.

Mobile (iPhone Safari, real device or Simulator)
- **A15** No horizontal scroll at 375 px. 2-column grid. The image bar stays
  pinned. The picker opens as a bottom sheet and closes on select. Add to cart is
  reachable without zooming.

---

## 9. QA checklist: regression pets

Use real generations of these pets (don't invent test cases). Run the checks on
`/shop` and on each product page, desktop Safari **and** iPhone Safari. Pass means
every product for that pet passes, never one good image.

| Pet | Tests for | Check on every product | Treatments |
|---|---|---|---|
| **Wizard** (black cat) | coat color | Coat reads **black** in every mockup, including under mug and pillow shading: never grey-washed, brown or orange. Cutout on a white mug: no light halo around the fur. The bat, if any, isn't silently cut off, or the mockup shows the cut exactly as it will print. | Full scene + Cut out |
| **Moses** | anatomy | The square crop (coaster, pillow) and the can cooler crop keep the whole head and don't imply extra or missing limbs by cutting at a leg. The cutout mask doesn't merge limbs. | Full scene + Cut out |
| **George** | muzzle + display name | The muzzle isn't clipped or squashed by any crop or perspective warp. **The display name stays fully visible on coaster, pillow and can cooler.** | Full scene |
| **Max** | benchmark, and the logged-out sample | Centered on every product (he has rendered off-center before). The logged-out hero looks like the brand at its best. | Full scene |
| **Darla** | known-good baseline | If Darla fails, the template is wrong, not the pet. Fix the template first. | Full scene + Cut out |

Minimum run: **5 pets × 7 products in Full scene (35 checks), plus Cut out on
mug, coaster and pillow for Wizard, Moses and Darla (9 checks).** Plus, for each
pet, one Exact-print overlay against a Printful draft (A10).

Journeys: logged out · logged in with no model · with a model but no generations ·
with generations · a foreign `?generation=` · a deleted generation · from Gallery
"Shop this image" · cart with mixed images → test checkout → the Printful draft
carries the right pet on each line.

**Cost to run QA:** Full-scene previews: nothing. Cut out: one rembg call per
unique image, cached, which is a few cents in total (confirm the fal rate).
Shopify test-mode orders and Printful drafts: free. Physical verification
(section 6): about $110-140, **only with Jake's yes.**

---

## 10. Launch blockers (before the store password comes off)

Already known:
- **L1** Shopify Payments **test mode OFF**.
- **L2** Remove every product from the **Online Store** channel (so nobody can buy
  on `shop.printpetz.com` without a pet), **then** remove the store password.
- **L3** Shopify checkout's **logo and "Continue shopping"** must go to
  `printpetz.com/shop`, not `shop.printpetz.com`. Test it on a real checkout.
- **L4** Backend **PR #53** (webhook hardening) merged. Still OPEN on 2026-09-26.
  Without it, **15 and 20 oz mugs print as 11 oz, and Slim coolers as Regular.**
  The shop can't offer sizes until it's merged.

Added by this spec:
- **L5** Shop is reachable from the site nav (A1). This is owner requirement 1.
- **L6** False copy removed: "ordering not yet available", the t-shirt mockups,
  the FAQ promising hats and shirts, and "exactly as you see it" over an uncropped
  preview (section 0, items 2-5).
- **L7** The **webhook trusts any `_generation_url`** from the cart
  (`shopify_webhook_controller.ts:69`, confirmed by reading the code on the
  `fix/webhook-hardening` branch). The Storefront token is public, so once the
  password is off anyone can have us print any image under our name. Resolve the
  image server-side from `_generation_id`, or at least require our CloudFront/S3
  host. (Architect raised this too, as Risk 6.)
- **L8** The guarantee and returns wording is decided (decision 1) and published
  as the Shopify refund policy, so checkout shows it.
- **L9** The cart ships (decision 3), or the "free over $100" claim comes off the
  product pages until it does.
- **L10** Printful has a payment method on file, and Jake decides when
  `PRINTFUL_AUTO_CONFIRM=true` goes on (until then real orders sit as drafts).
- **L11** (Nice to have) Untick the pre-ticked "Email me with news and offers" at
  checkout.

## Out of scope
Apparel, hats, the pint glass (needs wrap composition), pet products, gift cards,
discounts and bundles (the mug-with-wall-art bundle is a later growth test),
in-app order history, the credit-refund messaging (until M4-credit-refund ships),
international shipping copy.

---

## 11. Mockup fidelity bar (2026-09-26)

Written by `studio-manager` after looking at the 11 oz mug composites in
`Claude outputs/m4-measure/uv/` (and re-rendering them at full size locally with
`calib.cjs`, no API calls). Answers "how true must a shop mockup be before we can
sell from it?"

### What I saw (evidence for the rules below)
- **Our mug composite shows the art about 12-15% too big, and that crops the pet.**
  Compared with Printful's own mockup of George's real print file
  (`check-george-printful.png`), ours cuts off the top of the bat and pushes the
  cap to the top edge. At full size, **Wizard's ear tips are cut off** and the cap
  lettering touches the edge. Ear shape is on the never-change list, so this is
  an identity fail, not just a cosmetic one. It's also the *flattering*
  direction: the buyer sees a bigger pet than will arrive.
- **Vertical streaks in the top-right corner** of the print area (the sky or
  floodlight smeared into bars), on both George and Wizard. They're visible at
  product-page size.
- **The 500 px contact sheets hide defects.** `mug11-sheet2.jpg` looks clean. The
  older 1000 px panels (`mug11-*-panel.jpg`, from `composite.cjs`) are badly
  shattered and smeared: George's muzzle and name are unreadable, and the bottom
  ~15% is streaks. The newer `calib.cjs` fit is clean at 1000 px apart from the
  corner streaks. **Always judge at the largest size the shop displays.**
- **Colour and curvature match Printful's well.** Wizard reads black. The shading
  looks natural.
- **Cut out drops body parts, not just props.** George loses his bat. Wizard loses
  his **tail and black paws** (a black cat on dark dirt). That's 2 of 2 tested pets
  failing, and it's an anatomy failure.

### F1. What matters to a buyer, in order
1. **Missing or extra pet parts at the crop edge** (ears, tail, paws, muzzle, the
   display name, props). Tolerance: **zero.** Anything inside Printful's print
   area must be inside ours, and nothing outside it may appear in ours.
2. **Pet scale and position.** Tolerance: **scale within ±3%, offset within 2% of
   the print area** (about 0.07 in on a mug). Anything flattering (bigger or more
   centered than the print) counts as a fail even inside tolerance if it hides a
   crop.
3. **Coat colour.** Tolerance: the coat reads the same colour. Wizard's coat
   brightness is within ±5 L\* of Printful's. Background colour drift is fine.
4. **Curvature and shading.** Cosmetic. No numeric bar, unless it hides part of
   the pet.
5. **Render quality** at display size: no smear, streaks, shatter or halo, and the
   display name is legible.

### F2. Acceptance test, per product (run before any product shows a composite)
Reference = **Printful's own mockup of the real print file**, until the physical
samples (section 6) replace it.
1. Pets: Wizard, Moses, George, Max, Darla, using one real generation each (the same
   ones as the section 9 QA). Every treatment the product offers.
2. Build the print file through the **order path** (not the preview path).
3. Get Printful's mockup of that file on the **same `mockup_style_id`** as our
   template. This is free. At about 33 s and 2/min, the 35 full-scene renders take
   roughly 18 min. Cache them as test fixtures.
4. Render our composite on the same style at the **largest display size**.
5. **Automated check:** align ours to Printful's inside the print area (search
   scale 0.8-1.2, shift ±10%). Report the best-fit scale, x/y offset and the mean
   colour difference (ΔE) over the pet. Pass: scale 0.97-1.03, offset ≤2% on each
   axis, pet ΔE ≤6. Tune the ΔE bar on Darla: **if Darla fails, the template is
   wrong.**
6. **Human check** (side by side at 1:1, pass or fail per pet): ears, tail, paws,
   muzzle, name and props are all present exactly as in Printful's; there are no
   streaks, smear or halo; the name is legible; the coat colour is the same.
7. A product **passes only if all 5 pets pass steps 5 and 6.** Re-run after any
   change to the template, calibration or print plan.

### F3. What the shop shows until a product passes
**Recommendation: the flat "Exact print" preview for that product, and no
composite.** Don't show a composite with a caveat. A caveat doesn't un-crop
Wizard's ears, and buyers don't read it. Don't use live Printful mockups either:
33 s per image and 2/min means one person browsing 7 products uses 3.5 minutes of
quota.
- **Exception, and a cheap win:** logged-out visitors always see **Max**, and Max
  never changes. So pre-render **Printful's real mockups of Max** once (free, a few
  minutes) and use them for the logged-out showroom now.
- Per product, the switch is a flag: a product shows the composite once it passes
  F2. A flat preview is honest but weaker than the live on-product preview that
  Zazzle and Shutterfly have trained buyers to expect (section 7). So fixing the
  composite scale is the priority, not a nice-to-have.

### F4. Cut out
- **Not offered at launch.** It removes body parts on 2 of 2 pets tested, which
  breaks the one standard. Bring it back only when F2's human check passes on at
  least Wizard, Moses and Darla with **no body part lost**. A lost prop is
  acceptable only if the preview shows it missing.
- When it returns: Full scene stays the default everywhere. Cut out appears only on
  the product page, as the **real rembg result on the product**, shown next to the
  Full scene. Label it: "Background removed. Check the ears, tail, paws and
  anything your pet is holding: whatever is missing here will be missing on the
  print." The customer has to pick it on purpose. It's never pre-selected.

### F5. Is the composite good enough to sell from?
**Visually, yes, once the framing is fixed.** At full size, the `calib.cjs`
render's lighting, rim and shading are as convincing as Printful's own mockup.
That beats PugMug (a sample cat, not your pet), and it's the "your pet, live, on
the product" experience competitors charge proof-waits for. It's **not** enough on
its own for the product page. Crown & Paw sell with lifestyle, scale and
real-customer photos, so H4's scale shot and the later sample photos still matter.
Today it fails on framing (cropped ears and bat) and the corner streaks, so it
isn't sellable yet.

### Handoff to engineer
1. **Scale/offset:** our 11 oz mug composite shows the art about 1.12-1.15x bigger
   than Printful's mockup of the same print file, and shifted up. Compare
   `check-george-printful.png` with a 1:1 render from
   `calib.cjs` + `mug11-uv.png`/`mug11-white.png` + `upscale-eval/Wizard/Wizard-8x10-300dpi.jpg`.
   Wizard's ear tips are clipped. Target: the F2 step 5 tolerances.
2. **Corner streaks:** vertical bars in the top-right of the print area on both
   pets. Likely the polynomial fit extrapolating past u/v = 1 at the corner, where
   the result gets clamped. It must be gone at display size.
3. **Retire `composite.cjs`** (the per-pixel UV version). At 1000 px it shatters
   and smears. It must not reach the shop.
4. **Build the F2 harness** (Printful reference fixtures, alignment metrics and a
   side-by-side sheet at 1:1) so every product can be gated by a pass/fail flag.
5. **Hide Cut out** in the shop UI until F4's bar is met.

## 12. Showroom photography (2026-09-26)

Only one calibrated Printful style per product for now. Style list checked against
`Claude outputs/m4-measure/m40a.json`. The pillow and cooler style lists are empty
there, so their names are Jake's and not checked.

**Grid tiles: product only, on a plain background, all 7.** On a 2-column iPhone
tile (about 170 px) a lifestyle scene shrinks the pet to a thumbnail and puts the
room in front of it. Every scene also needs its own F2 calibration. Every tile
uses the same backdrop colour, set by us.

| Product | Style | Keep? | Risk to check | Tile text (scale cue) |
|---|---|---|---|---|
| Poster 8x10 | Transparent | Yes, with a soft shadow on our backdrop | With no shadow it looks like the Exact print view, not paper | "8 × 10 in print" |
| Framed 8x10 | Flat / Front | Yes | The frame colour must match the variant we sell. The lip covers the edges (H5) | "8 × 10 in, framed" |
| Canvas 16x20 | Wall / Wall | Yes. Front-on is the only honest view until U1 | It hides the depth and the wrap. Say "wrapped edges" in text only | "16 × 20 in canvas" |
| Mug 11 oz | Default / Front view | Yes | The handle side is unknown (U2). Show it on the product page | "11 oz" (+ "15 · 20 oz") |
| Pillow 18x18 | Default / Front | Yes, only if it's the puffed 3D render | The seams pull the edges in, so the mockup must show that | "18 × 18 in, insert incl." (only if H6 confirms) |
| Coaster | Flat / Front | Yes | It fills the tile the same way the canvas does, so it can look like a trivet (H4) | "3.74 in, drink-sized" |
| Can cooler | Flat / Front | Only if it reads as a cooler | Printful reviews report **white seams and a white bottom stripe**. The shot must show them | "Fits 12 oz cans" |

**Product page, later:** add one scale shot per product, each calibrated with F2:
canvas and framed in a room (Lifestyle), coaster with a drink, mug in a hand or on
a desk, pillow on a sofa, cooler in a hand. Until then the tile text is the scale cue.
