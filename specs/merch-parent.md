# Merch / print-on-demand — parent spec

Not executable. This lists the milestones and the order they go in.
Each milestone has its own spec and is independently executable.

## Goal
Let a customer buy physical product carrying artwork of their own pet, without the
printed image being a worse likeness than the one they approved on screen.

## The constraint that drives everything
Generated images are 832x1024 (OpenAI lane) / 820x1024 (fal lane) — under 1 MP.
At 300 DPI that prints at 2.7 x 3.4 inches. Anything larger than a postcard needs
upscaling. A 4x upscale reaches 4096px = 13.6 inches at 300 DPI, which covers a
12x16 poster.

Upscaling is where identity dies. Creative upscalers invent detail and will repaint
fur, shift markings, and soften muzzles. That breaks the one standard in CLAUDE.md
at the exact moment money changes hands. This must be measured, not assumed.

## Architecture — DECIDED 2026-09-22 (revised same day)
**Shopify headless (Storefront API) on the BASIC plan.** Store created:
`99ebb5-xt.myshopify.com`. $1/mo until **2026-12-21**, then $39/mo.

Catalog and cart live on printpetz.com via the Storefront API, which is available on
every Shopify plan. **Checkout redirects to checkout.shopify.com** for the final
payment step. That redirect is the one thing Plus would remove.

Plus was considered and rejected. It costs $2,300/mo against Basic's $39 — a $2,261
monthly gap — and buys on-domain checkout plus a 0.65% better card rate
(2.25% vs 2.9%). Recovering the gap on rates alone needs
**$2,261 / 0.0065 = ~$348,000/month in sales**, roughly $4.2M/year. Pre-launch with
zero customers, that is not a close call.

Upgrading later is trivial and the headless work carries over unchanged, so nothing
here is locked in.

Also rejected: Shopify's own hosted storefront (least code, but no control), and
Stripe + POD API direct with no Shopify (Stripe is already wired in this repo and
would give on-domain checkout free, at the cost of Shopify's merchant admin and order
management). Revisit the Stripe route only if Shopify's redirect proves to hurt
conversion.

**M2 must be built assuming the checkout redirect**, not around it.

### Store housekeeping, not yet done
- Store is still named "My Store" on a random `myshopify.com` subdomain.
- printpetz.com needs connecting as the storefront domain.
- The $1 promo ends 2026-12-21. Set a reminder.

## M3 — Printful integration, RESOLVED 2026-09-22 (was a blocker)
Token verified working against Printful's API (store id **18796047**, "My Store",
type **shopify**). `GET /orders` and `GET /webhooks` return 200. But
`GET /store/products` returns **400: "This API endpoint applies only to Printful
stores based on the Manual Order / API platform."**

That is not a scope problem. Printful stores have a platform type, and it decides how
fulfilment works:

- **Shopify-platform store** — Printful auto-imports orders from Shopify and fulfils
  them using the print file attached to the SYNCED PRODUCT. One fixed design per SKU.
- **Manual Order / API store** — orders are created via API with a **file URL per
  order**. This is the custom-artwork model.

**PrintPetz requires per-order files.** Every order carries a different pet. If
Printful auto-imports a Shopify order and fulfils from the synced product's stored
design, every customer receives whatever placeholder artwork is attached to that SKU.
That failure ships silently and looks correct until parcels arrive.

### RESOLVED — option 3 works. No second Printful store needed.
Tested 2026-09-22 with a real unconfirmed draft order (id 177621495, since discarded):

```
POST /orders  (no ?confirm -> draft)   -> 200
  item: variant_id 1320, White Glossy Mug (White / 11 oz)
  files: [{ url: <our print file on public storage> }]
  status: draft — nothing queued, nothing printed
```

Polling the order until Printful fetched the file:

```
file status: ok    dpi: 300    size: 2400x3000    preview: generated
```

**A Shopify-platform store DOES accept `POST /orders` with an explicit `files[]`
array.** The per-order file is used; the synced product's design does not override it.
M3 creates orders directly against this store.

Two things that fell out of the test and matter:

- **Printful reads the embedded DPI metadata.** It reported `dpi: 300`, which is the
  density the print-file service writes via `withMetadata({ density })`. That step is
  load-bearing, not cosmetic. Do not drop it.
- **Real costs for an 11oz mug**, which is the first true unit economics we have:
  subtotal $6.07 + shipping $6.69 + tax $0.65 = **$13.41 landed**. Shipping is half
  the cost of a single-item order, so multi-item carts are where margin lives. Note
  the catalog page advertises shipping "from $4.99"; actual was $6.69.

### Still open for M3
- Whether Printful ALSO auto-imports the same Shopify order, producing a duplicate.
  If it does, the Shopify integration must be set to not auto-fulfil, or orders held.
  **Test this before going live** — a duplicate order means printing and shipping
  everything twice.
- Confirmed orders (`?confirm=1`) were never exercised. Only drafts.

## Milestones

| # | Spec | What it settles | Blocked by |
|---|---|---|---|
| M0 | `merch-m0-upscale-eval.md` | Can any upscaler hold pet identity at 4x? Which one, at what cost per image? | nothing — start here |
| M1 | `merch-m1-print-file-service.md` | Print-file generation: Lanczos resize per product, subject-aware crop, canvas bleed | M0 — **DONE, spec written** |
| ~~M1b~~ | folded into M1 | Both treatments (panel + cutout) are customer-selectable. rembg tested and viable. | resolved 2026-09-22 |
| M2 | `merch-m2-storefront.md` | Catalog, product page, cart | architecture decision above |
| M3 | `merch-m3-order-fulfillment.md` | Push paid orders to the POD provider with the customer's print file | M1, M2 |
| M4 | `merch-m4-credit-refund.md` | Refund generation credits when an order containing that image is paid | M3 |

Only M0 is written. The rest get written once M0 reports back, because M0's answer
changes what products can exist.

M0 is COMPLETE — see `specs/merch-m0-report.md`. Verdict: use Lanczos,
no AI upscaler. **All tiers (2x, 3x, 4x) confirmed on physical prints** across multiple
pets including Wizard at 3.91x. Total cost to establish this: $0.155.

M1 covers both treatments. Jake decided 2026-09-22 to offer panel AND cutout as a
customer choice rather than hard-mapping one per SKU — the marginal cost is small and
fewer options means fewer sales. rembg was tested on Wizard and Moses, the two hardest
masks, and is viable. Two defects to engineer around: a matting halo visible on light
garments, and props that run off the source frame getting guillotined in cutout mode.

## Product catalog — tiered by upscale factor (researched 2026-09-22)
Source image is 832x1024 (4:5). Every product below is placed by the upscale factor
its print file needs. Lower factor = less invented detail = lower identity risk.
This is the ordering that matters: **ship the low tiers first.**

| Tier | Pixels | Products | DPI basis |
|---|---|---|---|
| **2x** | 1664x2048 | coaster, coffee mug, pint glass, thermos, koozie, lunch box | 300 DPI, small items viewed close |
| **3x** | 2496x3072 | t-shirt, sweatshirt, hoodie (12x16 front); 8x10 poster; 8x10 framed print | 150 DPI apparel / 300 DPI paper |
| **4x** | 3328x4096 | 16x20 canvas (19x23 file w/ 1.5in bleed); 18x18 decorative pillow; 11x14 framed | 150 DPI |
| **never** | — | 24x36 poster (needs 10800px long edge) | unreachable at any tested factor |
| **ruled out** | — | hats, anything embroidered | not a resolution problem — see below |

### Pet products — strong fit, researched 2026-09-22
Products the pet itself wears or uses, carrying its own portrait. Better audience fit
than apparel, and mostly flat full-bleed prints so the DTG transparency problem below
does not apply.

| Product | Tier | Notes |
|---|---|---|
| pet bowl | 2x | small wrap, 300 DPI |
| pet tag | 2x | tiny |
| collar, leash | 2x | narrow strip |
| food mat / placemat | 3x | ~12x18 @150 = 1800x2700 |
| pet bandana (AOP) | 4x | large all-over print, ~3300px short edge |
| pet bed | **out of reach** | 30x40 @120 DPI = 3600x4800, past 4x |

Provider note: **Printify** has the deepest pet catalog (bandana, bone-shaped food mat,
bed, pet tank/hoodie, tag, collar, leash, bowl). Printful's pet line is thin — AOP
bandana, bowl, leash, collar only. Prodigi and Gooten also dropship pet accessories
via API. This may mean running two providers: one for prints, Printify for pet goods.
Confirm exact print areas with the provider before committing a tier above.

### Printed dog toys — NOT AVAILABLE
No major POD dropshipper offers a custom-printed squeaky or plush dog toy.
Printify's "custom stuffed animals" are teddy bears wearing a printed t-shirt, not a
plush of the customer's pet. Plush-replica businesses (Budsies, Petsies, Cuddle
Clones) are handmade, $100-200, weeks of lead time, no dropship API. That is a
manufacturing business, not a POD SKU. Do not plan on it.

### How to tier a new product (Jake will keep adding these)
pixels needed = print size in inches x DPI (150 for large/soft goods, 300 for small
items viewed up close). Compare BOTH edges against what each factor gives:

- 2x = 1664 x 2048
- 3x = 2496 x 3072
- 4x = 3328 x 4096

If the short edge needed exceeds 3328, the product is out of reach. Square products
(coasters, pillows, mats) are judged on the SHORT edge, because a 4:5 portrait must be
cropped to fill them.

### Hats and embroidery — RULED OUT
Printful embroidery allows **6 thread colors** from a palette of 15. No gradients, no
color blends, no subtle shading. Printful's own guidance: photographs do not convert
well and come out unclear. Digitizing costs **$8.95 per design** — and since every
PrintPetz order carries a unique pet, that is $8.95 per customer, not a one-time fee.

A photorealistic pet portrait cannot be embroidered, and one-off digitizing destroys
the unit economics. Options: drop hats, or sell hats carrying the PrintPetz logo only,
with no customer pet on them.

### Apparel needs transparent backgrounds — UNSOLVED, M1 scope
DTG printing requires PNG with a transparent background. Any background present in the
file prints as a literal rectangle on the garment. PrintPetz generations are full
themed scenes — the stadium, the firehouse — and that scene *is* the product.

Two paths, both real work, decide in M1:
- Print the whole scene as a deliberate rectangular panel on the shirt.
- Cut the pet out and drop the theme, losing the thing the customer picked.

Drinkware, coasters, canvas, posters, pillows are unaffected — they print full-bleed
rectangles by design. This blocks apparel only.

### Aspect ratio
832x1024 is 4:5 — native for 8x10 and 16x20, no crop needed. Coasters are square, mug
and thermos wraps are landscape, pillows are square, 11x14 and 18x24 are neither.
Per-product cropping, bleed, and compositing is a print-file generation service and is
M1 work. Cropping a pet portrait badly cuts off ears; M1 must crop toward the subject,
not center-crop blindly.

## POD provider — recommendation, not decided
No account exists yet. All three below expose a per-order file URL at order creation,
so no Shopify product needs creating per generated image. Keep one product per SKU
and pass the customer's file URL at order time — the standard custom-artwork pattern.

| Provider | Poster DPI | Canvas DPI | Notes |
|---|---|---|---|
| Printful | 300 rec / 150 floor | ~150 | API v2 open beta: image URL + variant ID at order time, no pre-created product. Best print quality for art. |
| Printify | 300 rec | 300 on largest wall art (Prodigi/Sensaria) | Cheaper, quality varies by print network. 100MB file cap. |
| Gelato | 150 min / 300 ideal / 600 giclee | — | Strongest internationally. |

Printful remains the recommendation for art prints. Vistaprint was considered and
ruled out: no dropship order API and no blind shipping, so it cannot fulfill M3.

## Credits behavior (Jake's answer to #5)
Generating costs credits as it does today. When a customer buys merch carrying a
given generation, the credits spent on that generation are refunded.

Needs pinning down in M4: refund the 2 credits for that specific generation only;
fire on payment webhook, not checkout start; idempotent per generation id so the
same image cannot be bought twice for repeat refunds; decide whether a refunded
order claws the credits back.
