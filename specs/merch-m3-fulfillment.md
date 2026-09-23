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

## The duplicate-order question — CHECKED 2026-09-23

**Printful setting: "Manually confirm imported orders" is SELECTED.** Its text:
"All orders from your ecommerce store will be imported as drafts. You can then
confirm them to be fulfilled." Nothing auto-fulfils. Found at
Printful -> Settings -> Store settings -> Orders -> Order import settings.
**Do not change that radio.**

That removes the catastrophic case: no order ships twice, because nothing ships
without a human confirming it.

It does NOT remove duplication. The setting governs confirmation, not import —
Printful still imports every Shopify order. Once live, each Shopify order yields
**two Printful drafts**:

1. Printful's own import, carrying whatever placeholder design is on the synced product
2. M3's API order, carrying the customer's actual pet

Both drafts. Neither prints. Safe, but someone must pick the right one every time, and
picking wrong means printing a placeholder instead of the customer's pet.

**This is avoidable.** M3 uses Printful CATALOG variant ids (1320, 4463, ...), not
store-product ids, so fulfilment does not depend on the Shopify<->Printful app
connection at all. That connection exists only to create Shopify products for the
storefront. Options once products exist:

- Disconnect the Printful app from Shopify. Products stay in Shopify; imports stop.
- Or run a separate Printful store of type Manual Order / API for fulfilment only.

**Settle this before setting `PRINTFUL_AUTO_CONFIRM=true`.** While orders are drafts,
a duplicate costs nothing but attention.

## The original risk, now resolved — kept for context
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
