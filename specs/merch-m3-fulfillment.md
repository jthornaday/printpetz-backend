# M3 — Fulfillment: paid Shopify order to Printful

## Goal
When a customer pays on Shopify, Printful receives an order carrying **that
customer's pet**, printed on the product they bought.

## Done when
- [ ] `npm run replay-order -- --file=<shopify-order.json>` creates a Printful order
      and prints its id, status, variant and file status.
- [ ] The created Printful order carries the customer's generation, not a placeholder:
      the file URL resolves to that order's image and Printful reports `status: ok`
      at the DPI the product expects.
- [ ] Replaying the SAME Shopify order id a second time creates **no** second Printful
      order and says so. Webhook retries are normal; double printing is not.
- [ ] A line item whose generation or product cannot be resolved fails loudly and
      creates **no partial Printful order**. Half an order is worse than none.
- [ ] Orders are created as **drafts** unless `PRINTFUL_AUTO_CONFIRM=true`. Default is
      draft, so nothing prints by accident during development.
- [ ] The five regression pets each produce a valid Printful draft across at least two
      products, verified by file status, not by assumption.

## Context — proven 2026-09-22, do not re-litigate
See `specs/merch-parent.md`.

- `POST /orders` with an explicit `files[]` array **works on a Shopify-platform
  store**. The per-order file is used; the synced product's design does not override
  it. No second Printful store is needed. Verified with live draft order 177621495.
- Printful fetched our file and reported `status: ok, dpi: 300, 2400x3000`. It reads
  the DPI metadata the print-file service embeds. Do not drop that.
- Store id **18796047**, token in `.env` as `PRINTFUL_API_KEY`. Scopes verified:
  orders, files, webhooks.
- `GET /store/products` returns 400 on this store type. That is expected, not a bug.
  Use the catalog endpoints (`/products`, `/products/{id}`) for variant ids.
- 11oz White Glossy Mug is catalog variant **1320**.

## The duplicate-order question — RESOLVED 2026-09-23

Printful will not import our Shopify orders at all. There is exactly one Printful
order per Shopify order, and M3 creates it.

Configuration at Printful -> Settings -> Store settings -> Orders:

| Setting | State | Why |
|---|---|---|
| Manually confirm imported orders | **selected** | anything imported lands as a draft, never auto-fulfilled |
| Import existing products | unchecked | leave it |
| Automatic stock update | checked | marks a SKU out of stock in Shopify if Printful discontinues it |
| **Automatically import orders with synced products** | **UNCHECKED** | **this is the one that mattered** |
| Import personalized orders as drafts | unchecked | moot once nothing is imported |

The last-but-one is the fix. Printful's own description: "we'll fulfill all orders with
synced products, **overriding any apps that may interact with orders**." Our seven
products are synced products, so leaving it on meant Printful pulling in every order
and fulfilling it from the synced product's placeholder artwork — alongside the order
M3 creates with the customer's actual pet.

Unchecking it is safe because **M3 never needed Printful's import**. It creates orders
through the API using CATALOG variant ids (1320, 4463, ...), not store-product ids.
That path is proven end to end. Printful's import added nothing but a second order
carrying the wrong pet.

**Still verify on the first real order** that exactly one Printful order appears. The
setting text is unambiguous but has not been tested against live traffic, and
everything stays a draft until `PRINTFUL_AUTO_CONFIRM=true`, so a surprise here is
recoverable.

## The original risk, now resolved — kept for context## The original risk, now resolved — kept for context
Printful's Shopify app may **auto-import** the same order we create via API. If it
does, every order is fulfilled twice: once by us with the right pet, once by Printful
with whatever placeholder artwork is attached to the synced product. The customer gets
two parcels and one is wrong.

Before this milestone is considered done, confirm in Printful's store settings that
automatic order import/fulfilment is **OFF**. If it cannot be disabled, this design
changes and the milestone stops until it is resolved. Do not ship around it.

## What it must do
1. Receive Shopify `orders/paid`. Verify the HMAC signature — an unverified webhook is
   an open door to making us print things for free.
2. For each line item, resolve three things:
   - **which generation** the customer bought (the image)
   - **which product key** (`poster_8x10`, `mug_11oz`, ...)
   - **which treatment** (`panel` | `cutout`)
   These must ride on the Shopify line item as properties. M2 puts them there; until
   M2 exists, the replay script supplies them.
3. Build the print file via `buildPrintFile()` from M1. Do not reimplement it.
4. Upload it somewhere Printful can fetch over plain HTTPS. **Use the existing S3
   bucket** (`AWS_BUCKET`), the same path style as generated images. Do not introduce
   a new storage provider.
5. Map product key -> Printful catalog variant id.
6. `POST /orders` with recipient from the Shopify order and `items[].files[].url`.
7. Record the Printful order id against the Shopify order id, so a retry is a no-op.

## Constraints
- **Idempotency is not optional.** Shopify retries webhooks. Key on the Shopify order
  id and store the mapping before returning 200.
- Draft by default. `PRINTFUL_AUTO_CONFIRM=true` is the only way to confirm.
- Never partially fulfil. Build every line item's file first; only then create the
  order. A failure halfway through must leave nothing in Printful.
- Do not touch the generation pipeline, the credits system, or the generations table.
- Do not charge or refund credits here. That is M4.
- Verify the Shopify HMAC before doing anything else.

## Free-edit files
- `src/services/printful_service.ts` (new)
- `src/constants/printful_variants.ts` (new — product key -> variant id)
- `src/controllers/shopify_webhook_controller.ts` (new)
- `src/router/shopify_routes.ts` (new)
- `src/scripts/replay-order.ts` (new)
- `package.json` — the `replay-order` script entry only
- `specs/merch-m3-fulfillment.md` (this file)

Everything outside this list asks first. Registering the new router in `app.ts` is
expected — ask before editing it.

## Out of scope
- Anything customer-facing. No storefront, cart, product page or checkout. That is M2.
- Refunding credits when merch is bought. M4.
- Shipping rate quotes at checkout. Shopify and Printful handle that between them.
- Order status webhooks FROM Printful (shipped, cancelled) and the emails they would
  trigger. Worth doing, but later — the webhook scope is already granted for it.
- Retry/backoff queues. If Printful is down, fail loudly and let it be re-run.

## Approach (suggested, not mandatory)
- `printful_variants.ts` is a plain map so a new SKU is a line, not a code change.
  Only `mug_11oz -> 1320` is confirmed; look the rest up via `/products` and record
  where each id came from.
- The replay script is the real deliverable for testing. It takes a saved Shopify
  order JSON and runs the whole path, so M3 is fully testable with **no storefront**
  and no real customer.
- Build all files for an order, THEN create the order. Not per-item as you go.
- Biggest risk after duplicate-fulfilment: resolving the wrong generation and printing
  the wrong pet. That is the one failure the whole product standard exists to prevent,
  and it is invisible until a parcel arrives. Log the generation id and the file URL
  on every order created, so any complaint can be traced in one grep.

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
Read specs/merch-m3-fulfillment.md and execute it. Follow the House rules exactly.
Read specs/merch-parent.md first for what is already settled. Orders must be created
as DRAFTS unless PRINTFUL_AUTO_CONFIRM=true — nothing prints by accident.


## Hardening — 2026-09-26, after the first real order
The first real end-to-end order (Shopify 7530534600962 → Printful draft 178113067) passed,
and exposed or confirmed four problems, fixed together:

1. **Size.** The SIZE a customer paid for is the Shopify line item's `variant_id`; our
   `_product_key` only picks the print-file spec and is identical for every mug size.
   `SHOPIFY_VARIANT_TO_PRINTFUL` in `src/constants/printful_variants.ts` maps each Shopify
   variant to its Printful variant. Unmapped variants fall back to the product default and
   log a warning. The real order had sent a 20 oz purchase to Printful as 11 oz.
2. **Reply before working.** Shopify waits 5 s. The webhook now verifies, validates, answers
   200, and only then builds the file and creates the Printful order. Measured: 30 ms reply,
   sent before the Printful order existed. Trade-off: Shopify no longer retries a failure
   AFTER the reply, so those are logged as `SHOPIFY_FULFILLMENT_FAILED` with the full request
   for a manual `replay-order`.
3. **Unfulfillable orders answer 200.** No PrintPetz items, no address, half-specified lines:
   retrying can never fix these, and Shopify deletes a webhook subscription after 8 failed
   retries, which would silently stop every later order reaching Printful. They are logged as
   `SHOPIFY_ORDER_UNFULFILLABLE` — and each one may be a customer who paid and got nothing,
   so it needs a human. Prevent them at the source by keeping products off the Online Store
   channel.
4. **Test orders never print.** Shopify's `order.test` sets `forceDraft`, which overrides
   `PRINTFUL_AUTO_CONFIRM=true`. Verified with Printful intercepted: auto-confirm on + test
   order stays a draft; auto-confirm on + real order confirms.

`replay-order` now parses orders with the webhook's own `fulfillmentFromShopifyOrder`, so a
replay exercises exactly what production does, size mapping included.

Unverified: whether Printful's 15 oz and 20 oz mugs place the 2400x3000 side-panel file as
well as the 11 oz does. Check the first physical order of each size.

### 5. Only print our own images

`_generation_url` comes from the customer's browser, so the webhook printed whatever
address the cart carried. It now accepts only `https://<our CloudFront>/generations/…`
(`isOurGenerationUrl`). Anything else is an `UnfulfillableOrderError`: 200 to Shopify,
logged as `SHOPIFY_ORDER_UNFULFILLABLE`, nothing sent to Printful. Tested against
look-alike hosts, other folders on our CDN (training photos, print files), path
traversal, http, and garbage.

Still open: it does not check that the generation belongs to the person paying. That
needs the order to carry the user id; low risk (they'd be paying to print someone
else's pet art from a URL they'd have to obtain), so deferred.

### 6. Pillow and can cooler match Printful's real spec (found in shop M4.0)

- **Pillow orders were all rejected.** Printful product 83 requires `stitch_color`; we sent
  none → 400. Now sent from `PRINTFUL_VARIANTS.pillow_18x18.options` (white). Verified with
  a draft through `createFulfillmentOrder` (178117795, cancelled).
- **Regular can cooler** print file is now Printful's own 1260x1528 (was a 3.5x4in estimate
  that lost ~6% of the width to Printful's `cover` crop).
- **Slim can cooler is not sold** (hidden in the frontend): its print area is 1076x2085, and our
  file would lose ~41% of its width. Needs its own print spec before it comes back.
- Still unverified until a physical order: whether the pillow and cooler BACK is blank (we send
  one file, Printful records it as `default`).
