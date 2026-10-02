# PrintPetz launch checklist

Compiled on 2026-10-01 from two read-only audits: engineer (money, infra, failure paths) and
studio-manager (customer journey). The claims I re-checked myself are marked ✔︎.

**Status:** ✅ done · ❌ not done · ❓ unknown, Jake to check in a console.

The order of the sections matters: legal and safety first, switches last.

---

## A. Blockers: code work (Claude builds; Jake merges)

| # | Item | Status | Where |
|---|---|---|---|
| A1 | **Legal + contact pages.** `/terms`, `/privacy`, `/contact` all 404 ✔︎. Footer "Privacy Policy" and "Terms & Conditions" are plain text, not links ✔︎. Needs: terms including photo rights/IP ("only upload photos you have rights to", our licence to process and print), privacy, refund/reprint policy, and a support email. Add a consent line at signup. | ❌ | frontend `src/components/shared/Footer.tsx:8-9`, `PremiumFooter`, new pages |
| A2 | **Failure alerts.** Order failures only write to `error_logs` and the console. Nobody is told. Email Jake on any `SHOPIFY_*` or `PRINTFUL_*` error. Add a daily check that every paid Shopify order has a Printful order: fulfilment runs after the 200, so an EB restart mid-order (for example a merge to main) loses it with no log. | ✅ 2026-10-02: email alerts live (#73): unfulfillable order, Printful create failure after 3 tries, Printful orders failed/on hold every 15 min, test email received. Durable intake + auto-retry live (#74 + merch_orders migration, verified). Not covered: Shopify-side reconciliation (no admin token). | backend `shopify_webhook_controller.ts:155-210` |
| A3 | **Shipping truth in the shop.** "Free shipping on orders over $100" can't happen ✔︎: every Buy is a single-item checkout, and the top price is $89. Show the real shipping cost, delivery time (production 2–5 + transit 3–4 business days) and the reprint/refund line. Drafts are in spec §5. | ✅ 2026-10-02: frontend PR #51. Real tiers verified against the live checkout; US only; turnaround and promise shown; the unreachable $100 claim removed. | frontend `Showroom.tsx`; backend `specs/merch-m4-shop-showroom-product.md` §5 |
| A4 | **Landing copy.** "Physical product ordering is not yet available" and "COMING LATER" ✔︎. Change this in the same PR that turns the shop on. | ❌ | frontend `Landing/index.tsx:23,51` |
| A5 | **Credits can't be self-set.** The browser writes the `users` row directly with whatever fields it sends ✔︎. Safe only if RLS blocks it (see J1). If not, move user updates server-side or limit RLS to safe columns. | ✅ 2026-10-01: the hole was real (one FOR ALL policy). Fixed in production by Jake's SQL run; verified: policies are now SELECT plus UPDATE, and the browser can only update email, name, profile_image. Migration: `supabase/migrations/20261001_lock_users_credits.sql` | frontend `src/store/api/userApi.ts:47-55` |

## B. Should-fix before real volume (code)

| # | Item | Where |
|---|---|---|
| B1 | **Tracking / "where's my order".** Nothing marks Shopify orders fulfilled, so no shipping email goes out. Add a Printful `package_shipped` webhook that creates the Shopify fulfilment with tracking, or for now turn on Printful's own customer emails (J4). | backend, new webhook — ✅ 2026-10-02 (#75): customer tracking email per package, polled from Printful. Shopify still shows Unfulfilled (no Admin token). |
| B2 | **Refunds and cancels.** A refunded or cancelled Shopify order still prints. Add a handler that cancels the Printful order. | backend — ✅ 2026-10-02 (#75 + Shopify webhooks orders/cancelled and refunds/create): a cancel stops the print when Printful hasn't started and alerts either way; refunds alert. |
| B3 | **Stripe double credit.** A redelivered webhook adds credits twice. Payment status is never checked to be `paid`. The credit update is read-then-write, so it races with generation charges. Fix with idempotency on the event or session id and an atomic increment. | `stripe_service.ts:155-167`, `user_service.ts:109-111` |
| B4 | **Printful double order.** The check-then-create isn't atomic. Two copies of a webhook arriving during the 4–18 s file build can both create an order, and a lookup error counts as "none yet". | `printful_service.ts:120,164-198` |
| B5 | **Free tools and no rate limits.** `edit-look` and `remove-background` need sign-in ✔︎ but charge nothing and accept any image URL, so they're a free paid-fal proxy for any account. There's no rate limiting anywhere. The credit check happens before the charge, so parallel requests can overspend. | `generation_controller.ts:558-606`, `app.ts` |
| B6 | **Plan page copy.** It promises "unlimited images" and "Unlimited storage" and says "Choose your plan", but it sells credits. | frontend `Plan/index.tsx` |
| B7 | **Wasted spend.** Each previewed image pays fal for cut-out previews we don't offer. Failed previews retry on every poll. | `merch_preview_service.ts:54,357` |
| B8 | **Image ownership on orders.** The webhook accepts any PrintPetz-hosted image URL without checking it belongs to the buyer. | `shopify_webhook_controller.ts` |
| B9 | **CORS** is fully open. That's low risk because sign-in uses tokens, but it should be limited to printpetz.com. | `app.ts:37` |

## C. Jake: console and decisions (in this order)

| # | Item | Status |
|---|---|---|
| J1 | Users RLS check, which decides A5. | ✅ done 2026-10-01 |
| J2 | Decide: the support email address; the refund/reprint promise (for example "wrong or damaged → free reprint, tell us within 30 days"); whether new accounts get free starter credits. Training costs 30 credits, and no signup grant was found in code. | ❓ |
| J3 | **Stripe live** (credits). Live keys go in EB `STRIPE_API_KEY`. Create live webhook endpoints for `/webhook/stripe/checkout-completed` and `/webhook/stripe/price-change`, and put their secrets in `STRIPE_*_WEBHOOK_SECRET`. Create live prices, each with `credits` metadata: without it a buyer pays and gets 0 credits. Then delete the old test price rows from the DB: the Plan page shows every row. Turn on Stripe email receipts. | ❌ |
| J4 | **Printful.** ⚠️ 2026-10-02: bowl sample order #178674803 FAILED with "Insufficient Funds" (code 55) on 2026-09-30. The card on file was declined and nobody was alerted. Fix billing first. A2's alerting must cover Printful `failed` orders: today a paid Shopify order would just never print. Decide on customer notification emails (on until B1 exists). Check what happens when a charge is declined. Set `PRINTFUL_AUTO_CONFIRM=true` in EB **only at launch**: until then every real order stays an unprinted draft. | ❌ |
| J5 | **Shopify, in order:** turn Payments test mode off → take products off the Online Store channel → point the checkout logo and "Continue shopping" at printpetz.com/shop → untick the pre-ticked marketing checkbox → read the refund and shipping policy pages → confirm the orders/paid webhook still exists (Shopify deletes it after repeated failures) → **remove the store password last**. | ❌ |
| J6 | Is the old "Order print" button visible on printpetz.com today? It shows whenever the Shopify env vars exist, even with the shop off. Open any image on the live site and look. | ❓ |
| J7 | **Go live:** set Amplify `NEXT_PUBLIC_SHOP_MODE=on` and rebuild, together with the A4 copy PR. | ❌ |
| J8 | **Smoke test with a real card:** buy the smallest credit pack, and order one coaster. Check that credits arrive, the Printful order confirms, emails arrive and tracking flows. Refund both. | ❌ |
| J9 | **Judge.me at launch** (installed 2026-10-02 on the Free plan. Paused by UNTICKING "Send requests for domestic orders" under Request scheduling → Domestic orders. There is no separate on/off switch. The schedule is Paid + 20 days, US): upgrade to **Awesome** ($15/mo, a 15-day trial starts on click), set **1 reminder after 7 days**, **auto-publish all ratings**, **coupons 15% / 20% with photo** (single-use, 60 days), **transparency badges: Show all**, paste the request copy from specs/merch-reviews-followup.md §5, then **re-tick "Send requests for domestic orders"**. Don't use "Request reviews from previous Shopify orders": it would email test orders. | ❌ |

## D. Already fine

- printpetz.com → Amplify and shop.printpetz.com → Shopify are separate. The apex is not on Shopify.
- No `.env` or known key format has ever been committed in either repo.
- The Shopify webhook secret matches production.
- Printful billing is on file: the sample orders were charged.
- The live site never calls Printful's mockup API, so the 2/min limit is irrelevant.
- The pet bowl stays hidden until the sample is approved. Cut-out is off. The post-purchase redirect works.

## Nice-to-have, after launch

- Share previews: there are no title, description or og:image tags, and no robots.txt or sitemap.
- The model-ready email is off-brand (purple, "AI model"). There's no email when training fails, though credits are refunded.
- Empty-state copy.
- A footer overlap on short phones on login/signup. Not tested on a device.
- A cart, so one shipment can hold several items.
