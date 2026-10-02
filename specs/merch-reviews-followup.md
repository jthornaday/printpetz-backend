# Post-purchase follow-up and reviews — research and plan

Status: **research and recommendations only. No code has been written.** Drafted 2026-10-02 by studio-manager.
Depends on: the shipped-email work on branch `feat/tracking-refunds` (migration
`supabase/migrations/20261005_order_tracking_cancel.sql`, `src/services/order_tracking_service.ts`).

## The short version

- **Put reviews on our own product pages with Judge.me.** Google Business Profile is not an option: online-only
  businesses are not eligible. Trustpilot bans every kind of review incentive, and its free plan allows 50 invitations
  a month. Okendo and Yotpo cost more and lock headless support behind expensive tiers.
- **Four emails, no texts in version 1:**
  1. "Shipped": already being built.
  2. A check-in from us, about 8 days after it ships. It has no review link and goes to the support inbox.
  3. A review request from Judge.me, about 20 days after payment, sent to everyone.
  4. One reminder.
- **Offer a coupon for any honest review**, the same at every star rating, with the incentive disclosed. Give a bigger
  coupon for a photo of the pet with the product. Those photos are the most valuable marketing asset this program will
  produce.
- **Be realistic about volume.** At 50 orders a month and a typical 5–10% review rate, we get about 3–5 reviews a month.
  Google Shopping stars need 50 reviews, so they are about a year away. The near-term payoff is a handful of real,
  verified photo reviews on the product pages, which is what a first-time buyer of a $25–$89 custom product looks for.

---

## 1. Timing and sequence

### What a normal order looks like
Payment → Printful makes it (2–5 business days) → ships → arrives (3–4 business days).
In calendar days, delivery lands **7–13 days after payment** (5–9 business days, plus weekends).
`merch_orders.received_at` is effectively the payment time, and `shipped_at` is being added by the tracking branch.

### The sequence

| # | Message | Sent by | When | Contains a review link? |
|---|---|---|---|---|
| 0 | Order confirmation | Shopify (exists) | At payment | No |
| 1 | "On its way" with tracking | Our backend via Resend (being built) | Per Printful shipment | No |
| 2 | **Check-in**: "How did it turn out?" | Our backend via Resend | `shipped_at` + 8 days (about 2–4 days after estimated delivery). **Skip it if that falls later than 17 days after payment**, so it never lands alongside the review request. | **No.** It's a service message. Replies go to the support inbox. |
| 3 | **Review request** | Judge.me | **Payment + 20 days** (Judge.me "Paid" trigger) | Yes, to **every** buyer |
| 4 | Review reminder (one only) | Judge.me | 7 days after #3, only if they haven't reviewed | Yes |
| 5 | Thank-you with coupon | Judge.me | About 30 minutes after a review is submitted | No |

Why Judge.me times off **payment** rather than delivery: Judge.me schedules review requests from Shopify order events
(Created, Paid, Fulfilled, Delivered, Archived). Our Shopify orders are **never marked fulfilled**, because the backend
has no Admin API token and Printful doesn't import our orders. So "Fulfilled" and "Delivered" will never fire, and
"Paid + 20 days" is the trigger that works. With the slowest normal delivery at day 13, that leaves at least a week
of use before we ask.

**Known weakness:** an order that gets delayed (Printful on hold, failed billing, a reprint) can be asked for a review
before it arrives. At launch volume this is a manual fix: when a Printful failed or on-hold alert arrives, or a
reprint is made, postpone that order's request in Judge.me → Review requests. *Untested: confirm the dashboard lets
you postpone, and not just cancel.* The permanent fix is optional item 7.2: an Admin token so Shopify orders get
marked fulfilled, which lets Judge.me use the "Fulfilled" trigger.

### Sending unhappy customers to support without "review gating"

Review gating means screening customers for sentiment and asking only the happy ones for a public review. The FTC's
guidance says plainly: "Don't ask for reviews only from customers you think will leave positive ones." The 2024 rule's
Q&A says gating could still break the FTC Act even though the rule has no specific clause on it. Trustpilot calls
cherry-picking "illegal". Google bans it too. Fashion Nova paid $4.2M for suppressing negative reviews.

The design keeps service and reviews as **two separate tracks that never filter each other**:

1. **The check-in (#2) has no review link and no rating buttons.** It asks one open question, with "hit reply" as the
   only action, and restates the promise: damaged or wrong → reply with a photo within 30 days → free reprint or full
   refund. No "rate us 1–5, and if you pick 4–5 we send you to reviews" step. That is exactly the gating pattern.
2. **The review request (#3) goes to every buyer, whatever they said in reply to the check-in.** That includes
   customers who complained and customers who got a refund. The only orders skipped are ones that were **cancelled
   or never shipped**, because the FTC also says not to ask people who never used the product. That rule is based on
   what happened to the order, not on how the customer feels.
3. If a reprint is in progress, **postpone** that customer's review request until the reprint arrives. Never cancel
   it. They should review the product they ended up with.
4. **Judge.me must auto-publish every star rating.** By default Judge.me lets you auto-publish 4–5 stars and hold
   1–3 for manual approval. Turn that off. Holding back low ratings while the page shows an average is the
   suppression the FTC rule (16 CFR 465.7) targets. Hide a review only for content reasons (profanity, personal
   data, spam, not about the product) applied equally to all ratings.
5. **Reply publicly to every negative review** with the fix offered (template in §5). A visible 2-star review with a
   reply saying "reprinted free" is more convincing than a page of perfect 5s.

---

## 2. Where reviews should live

| Option | Cost | Works with our headless checkout? | SEO / trust value | Photo reviews of the pet on the product | Verdict |
|---|---|---|---|---|---|
| **Google Business Profile** | Free | n/a | High for local businesses | Yes | **Not eligible.** Google: "Business Profiles aren't for online-only businesses." We have no storefront and no in-person service. |
| **Google Customer Reviews / Merchant Center ratings** | Free | Needs Merchant Center and a survey opt-in on the order page | Stars in Shopping ads and listings | No (Google's survey) | **Later.** Product ratings need 50+ reviews and store ratings about 100. Judge.me Awesome can feed Shopping once we're there. |
| **Trustpilot** | Free: 50 invites/month. Paid: $99–$799/month on annual contracts | Yes (invite by email or link) | Medium. Recognized, but a brand-new page with 3 reviews looks thin, and anyone can post. | Limited | **Not v1.** Bans **all** incentives, so we couldn't run the coupon. Revisit at about 100+ orders/month. |
| **Shopify Product Reviews (native app)** | — | — | — | — | **Gone.** Removed May 2024. Shopify now has a standard review metaobject and `reviews.rating` metafield, but collection still needs an app. |
| **Judge.me** | **Free**, or **Awesome at $15/month flat** | **Yes.** It reads orders from Shopify whatever the storefront is. Platform-independent widgets and a public widget API (public token) work for headless sites. | Good. Product-page reviews can carry **Product** rich-result stars, which Google allows on your own site for products (the "self-serving" ban covers LocalBusiness/Organization). Verified-buyer badges. | **Yes.** Unlimited photo and video reviews on Free. | **Recommended.** |
| **Okendo** | Free up to 50 orders/month, $19 up to 200. **Headless/API support only on the Advanced plan, about $499/month** | Only at that tier | Good | Yes | Too expensive for headless. |
| **Yotpo** | Free up to 50 orders/month, then about $79/month and up | Yes, but paid tiers | Good | Yes | More than we need. |
| **Our own review system** | Engineering time | Yes | Same SEO if we emit the markup | Yes, if we build upload and moderation | **No.** We would rebuild verification, moderation, photo upload, unsubscribe handling and a Google feed for nothing. |

### Judge.me: Free vs Awesome

| | Free | Awesome ($15/month) |
|---|---|---|
| Review request emails, unlimited | Yes | Yes |
| Photo and video reviews, on-site widget, star badge, rich snippets | Yes | Yes |
| Automatic reminder email | **No** (it's listed as "advanced collection") | Yes |
| Coupons for reviews | **No** | Yes |
| Custom email design and CSS | No | Yes |
| Google Shopping feed | No | Yes |

**Recommendation: Awesome.** The reminder and the coupon are the two biggest levers on review volume, and $15 a month is
flat however much we grow. If Jake would rather spend $0 at launch, Free still works: one request, no reminder, no
coupon. Expect noticeably fewer reviews.

### Headless facts that matter for us
- Judge.me reads **Shopify orders**, so our headless checkout is fine. It doesn't need our storefront to be on Shopify.
- **Reviews created through Judge.me's API can't be marked verified.** That's why Judge.me sends the request itself, and
  we don't build our own review form that posts through the API.
- Reviews submitted from the widget on our site are verified after the reviewer confirms by email **and** the email
  matches an order. That's an extra step, so most reviews should come through Judge.me's own request email.
- **SEO:** Judge.me's rich snippets assume a Shopify theme. On our Next.js site we must render the reviews and the
  `Product` JSON-LD (`aggregateRating` plus a few `review` entries) **on the server**, from Judge.me's widget API, so
  Google sees them without running JavaScript. Show the markup only when there is at least one visible review.
- **Untested risk:** links in Judge.me emails may point at Shopify product URLs on `shop.printpetz.com`, which is
  password-protected now and will have its products taken off the Online Store channel (launch checklist J5). Check on
  the first test request where "Write a review" and the product link go. They must open Judge.me's own form or
  printpetz.com.

---

## 3. Texts (SMS)

**Verdict: no texts in version 1. Add them later, once email is running and we have about 100+ orders a month.**
Also leave Shopify's checkout SMS checkbox **off** until then.

Why we're waiting:
- **Consent.** A text asking for a review that also carries a coupon is marketing. Marketing texts need **prior express
  written consent**: a clear disclosure that names PrintPetz and says consent is not a condition of purchase. A
  shipping-update phone number is not consent to marketing. Misclassifying a promotional text as "informational" is a
  classic TCPA lawsuit, and the law sets damages per text ($500, up to $1,500 if willful).
- **Registration.** US business texting from a normal number needs **A2P 10DLC** registration: brand and campaign
  vetting, sample messages, and a live site with a privacy policy that covers SMS. Twilio charges $4.50 for the brand,
  a $15 campaign vetting fee, then $1.50–$10 a month. Messages cost about $0.0083 plus $0.0035–$0.005 in carrier fees
  each.
- **Quiet hours.** Federal: 8am–9pm in the recipient's local time. **Florida, Oklahoma and Washington: 8am–8pm.
  Maryland: 9am–8pm.** Some states cap texts at 3 per 24 hours. We'd have to work out each customer's timezone from
  their shipping address.
- **STOP / opt-out.** STOP, and any reasonable way of saying no, must be honored within 10 business days (FCC rule,
  April 2025). The part that makes one opt-out cover all message types has been delayed. Check its status before
  launching texts.
- The FCC's "one-to-one consent" rule was **struck down** (11th Circuit, January 2025), so that is no longer a factor.
- **Payoff.** At launch volume, texts might add 1–3 reviews a month. The legal exposure is out of all proportion to that.

When we do add texts:
- **Consent:** turn on Shopify Checkout → "Consent for marketing" → SMS. Edit the checkbox wording to: *"Text me order
  updates and offers from PrintPetz. Msg frequency varies. Msg & data rates may apply. Reply STOP to cancel. Consent
  is not a condition of purchase."* Shopify needs a Terms of Service and Privacy Policy set up first. Store the
  customer's SMS consent from the `orders/paid` webhook (`customer.sms_marketing_consent`; *confirm the field name in
  a real payload*).
- **Provider:** the simplest is **Klaviyo SMS** (about $15 for 1,250 credits, 1 credit per US text) connected to
  Judge.me, because Klaviyo handles consent records, STOP, and quiet hours. The cheapest is **Twilio direct** (prices
  above), but then we build consent logging, STOP handling and quiet hours ourselves. Don't use Attentive or Postscript
  at our size.
- **One text only:** the review request, sent the same day as email #3, within 10am–7pm in the recipient's local time.

---

## 4. Incentives

**Allowed**, under the FTC's 2024 rule (16 CFR 465, in force since 2024-10-21) and its marketer guidance:
- Giving something of value for a review, **as long as it doesn't depend, openly or by implication, on the review being
  positive.**
- The incentive must be **disclosed** in the review. Judge.me's "Incentivized review" transparency badge does this, and
  Judge.me tags these reviews `is_incentivized_review` in its Google Shopping feed.
- **Tying it to a photo** is fine: it depends on what the review contains, not how positive it is.

**Not allowed:**
- Coupons only for 4–5 stars. Judge.me removed that option anyway.
- Reviews from Jake, family, friends, or anyone on a test order, unless the review discloses the relationship (the
  rule's insider-review clause). **Don't seed the page before launch.**
- Any incentive on Trustpilot or Google. Both ban incentives outright.
- Hiding or delaying negative reviews (see §1).
- Using a reviewer's pet photo in ads or social posts without asking them first. Ask by email ("Can we share your photo
  of Max?") and keep the yes.

**What we recommend:**
- **15% off the next order for any review, or 20% with a photo of the pet with the product.** Same at every rating.
- Single-use codes generated by Judge.me, valid for 60 days.
- Restricted to reviewers who got a request (Judge.me setting), so random visitors can't farm codes.
- Margins are 55–76% and the customer pays shipping, so 20% off a $25 mug costs $5 of margin on an order we only get
  because of the coupon.
- It doubles as a repeat-purchase driver: "another one for the same pet" is our most likely second sale.
- Turn on Judge.me's transparency badges ("Show all").

---

## 5. Draft copy

House rules for these messages:
- Royal blue, black and white.
- Plain and direct. No "pawsome", "fur baby", emoji or exclamation marks.
- Say the pet's display name wherever we have it.
- Square brackets are placeholders.
- Never promise more than the policy: wrong or damaged → free reprint or full refund, tell us within 30 days, with a
  photo.

### #2 Check-in (ours, Resend; `reply_to` = myprintpetz@gmail.com)
**Subject:** How did [Max]'s [mug] turn out?
**Preview text:** One question from PrintPetz.

> Hi [Jake],
>
> Your order [#1042], the [15 oz mug] with [Max] on it, should be with you by now.
>
> [image of their pet artwork]
>
> How did it turn out? Hit reply and tell us. Jake, the owner, reads every reply.
>
> If it arrived damaged, misprinted, or not what you ordered, reply with a photo within 30 days. We'll reprint it
> free or refund you in full, your choice.
>
> Not there yet? [Track your package]
>
> PrintPetz
>
> *[postal address] · Reply "stop" and we won't send more follow-up emails.*

No rating buttons and no review link, on purpose (see §1).

### #3 Review request (Judge.me template, Awesome plan)
**Subject:** Rate your PrintPetz [product]
**Preview text:** Honest reviews only. Takes a minute.

> Hi [first name],
>
> You've had your [product] for a little while now. How would you rate it?
>
> [ ★ ★ ★ ★ ★ ]
>
> Good or bad, we want the honest version. It helps other pet owners decide, and it tells us what to fix.
>
> **Your review earns 15% off your next order, or 20% if you add a photo of your pet with it. Same discount whatever
> you rate us.**
>
> Something wrong with your order? Email myprintpetz@gmail.com with a photo and we'll reprint it free or refund you
> in full. That's separate from your review, and you're welcome to do both.
>
> PrintPetz

### #4 Reminder (Judge.me, 7 days later, once)
**Subject:** Last ask: rate your [product]

> Hi [first name], one last nudge and then we'll leave you alone.
>
> [ ★ ★ ★ ★ ★ ]
>
> The offer stands: 15% off your next order for any honest review, 20% with a photo of your pet.
>
> PrintPetz

### #5 Thank-you with coupon (Judge.me)
**Subject:** Thanks for the review. Here's your code.

> Thanks, [first name]. Your code: **[CODE]**, [15/20]% off your next PrintPetz order, good for 60 days.
>
> Same pet, new product? [Shop printpetz.com]

### Public reply to a negative review (posted by Jake in Judge.me)
> Thanks for telling us, [first name]. That's not the standard we hold ourselves to. We've emailed you about a free
> reprint or a full refund, your choice.

### Later: SMS review request (v2 only; needs written marketing consent)
> PrintPetz: How'd [Max]'s [mug] turn out? Rate it here: [link]. Problem? Reply and we'll make it right. Reply STOP to
> opt out.

---

## 6. Build plan (smallest version)

### 6.1 Data: what we have, and the gaps

| Need | Source today | Gap |
|---|---|---|
| Customer email | `merch_orders.request.recipient.email` (from `order.email` in the webhook) | None |
| First name | `request.recipient.name` (full shipping name) | Use the first word, or store `order.customer.first_name` when the order arrives |
| Order number | `merch_orders.order_name` | None |
| Payment time | `merch_orders.received_at` | None |
| Product | `request.items[0].productKey` → product label | None |
| Pet display name | `request.items[0].generationId` → generation → model → `models.pet_name` | Lookup needed. Fall back to "your pet". |
| Pet image | `request.items[0].sourceImageUrl` | *Untested:* confirm email clients can load it publicly. If not, leave the image out. |
| Ship date | `merch_orders.shipped_at` (tracking branch) | None once merged |
| Tracking link | Printful `/orders/{id}` shipments | Not stored. Save `tracking_url`, or fetch it again when the check-in is sent. |
| Cancelled | `merch_orders.status = 'cancelled'`, `cancelled_at` (tracking branch) | None |
| Test order | `merch_orders.test` | None |
| Check-in sent | — | **New column** |
| Opted out of follow-ups | — | **New table** |

Delivery date: Printful's v2 API reports `delivered_at` and has a "shipment delivered" webhook. Our code uses v1.
Don't adopt v2 for this: `shipped_at + 8 days` is good enough. Revisit only if check-ins visibly land before packages
do.

### 6.2 Jake's setup in Shopify and Judge.me (no code; about 1 hour)
1. Install **Judge.me Product Reviews** on the Shopify store. It's a reviews app, not a print-on-demand app, so the
   "never install POD apps" rule doesn't apply. **Pause automatic requests until launch** (until the store password
   comes off), so test orders don't generate requests.
2. Collect Reviews → Schedule: trigger **Paid**, delay **20 days**, US orders. Reminder: **1**, after **7 days**
   (Awesome).
3. Publishing and moderation: **auto-publish all ratings (1–5 stars).**
4. Coupons (Awesome): 15% for text, 20% with a photo or video; Judge.me-generated single-use codes; 60-day expiry;
   only reviewers who got a request.
5. Widget → Transparency: **Show all** badges.
6. Edit the request and reminder templates with the §5 copy. Colours: royal blue `#2454df` (matches the shipped
   email), black, white.
7. Sender: start on Judge.me's default sender (no DNS work). A custom sender later needs DKIM/Return-Path records on a
   printpetz.com address that someone reads. Replies go to that address.
8. Settings → General → Developers: turn on **platform-independent widgets**. Copy the **public** API token for the
   frontend. The private token stays out of the browser, and nothing in v1 needs it.
9. Make sure the Shopify store address (it appears in Judge.me email footers) is the postal address Jake chose (see
   decisions).

### 6.3 Handoff to engineer: backend (one PR, after `feat/tracking-refunds` merges)
1. **Migration** `supabase/migrations/20261006_followups.sql`:
   - `alter table merch_orders add column checkin_sent_at timestamptz;`
   - `create table email_suppressions (email text primary key, source text, created_at timestamptz not null default now());`
     with RLS on and `revoke all from anon, authenticated` (same pattern as `20261004_merch_orders.sql`).
   - A partial index on `merch_orders (shipped_at) where checkin_sent_at is null and status = 'fulfilled'`.
2. **`src/services/order_tracking_service.ts`:**
   - Add a `checkInEmail()` builder next to `shippedEmail()`, using the same HTML style and the §5 #2 copy, with `reply_to`
     set to the support address.
   - Add a `sendCheckIns()` sweep run on the existing shipment-watcher interval. It selects rows where all of these hold:
     - `status = 'fulfilled'`, `test = false`, `cancelled_at is null`, `checkin_sent_at is null`
     - `shipped_at <= now() - 8 days`
     - `received_at >= now() - 17 days` (otherwise skip; mark it skipped so it isn't re-selected)
     - the email is not in `email_suppressions`
   - Claim each row **before** sending: `update … set checkin_sent_at = now() where shopify_order_id = $1 and
     checkin_sent_at is null returning …`. That is at most one send across several EB instances. A lost email beats a
     duplicate.
   - Send only between 14:00 and 23:00 UTC (10am–7pm Eastern). This is a courtesy, not a legal requirement for email.
3. **Opt-out:** the footer says reply "stop". Add `npm run suppress-email -- <address>` to insert into
   `email_suppressions`, and have Jake run it when someone asks. Expected volume is near zero. A one-click unsubscribe
   link with a signed token is a later upgrade, and it needs a new env secret, which is a Jake gate.
4. **Footer:** the postal address, from a new env var `PRINTPETZ_POSTAL_ADDRESS`. If it's unset, send without it and
   log a warning.
5. **Tests:** a unit test for the selection rules (cancelled, test, too early, too late, suppressed, already sent), and
   a snapshot of `checkInEmail()` output.

### 6.4 Handoff to engineer: frontend (after the M4 `/shop/[product]` pages exist)
1. Product page: Judge.me star badge under the price, and a reviews section below the fold, fetched **on the server**
   from Judge.me's widget API with the public token. Map each `productKey` to its Shopify product id.
2. A `Product` JSON-LD block with `aggregateRating` and up to 5 `review` items, rendered on the server, only when
   `reviewCount >= 1`.
3. Before product pages exist: a "What customers say" strip on `/shop` showing store-wide reviews, hidden until there
   are at least 3.
4. No placeholder or seeded reviews, ever.

### 6.5 Costs
| Item | Cost |
|---|---|
| Judge.me Awesome | $15/month (15-day free trial). Free plan: $0. |
| Resend | Existing account. A handful of extra emails per order. |
| Coupons | 15–20% off the next order, only when a review leads to a purchase |
| SMS (later) | About $20 one-time for Twilio 10DLC, $2–10/month, about 1.2–1.3¢ per text. Or Klaviyo credits from $15. |

### 6.6 What to watch (in Judge.me's dashboard; nothing to build)
- **Review rate per delivered order.** Expect 5–10%. Under 3% after 30 orders means fix the timing or copy.
- **Share of reviews with a photo.** Aim for 30% or more. These are the marketing asset.
- **Check-in reply rate, and how many replies report a problem.** The problem rate is the real product-quality signal.
- **Average rating.** Investigate any product averaging under 4.0 before buying ads for it.

---

## 7. Decisions only Jake can make (recommendation first)
1. **Review platform:** Judge.me on our own product pages. Not Trustpilot, Okendo, Yotpo, or a home-built system.
   Google Business Profile isn't available to us.
2. **Judge.me plan:** Awesome at $15/month, for the reminder, coupons and branded emails. The alternative is Free with
   one request, no reminder and no coupon.
3. **Incentive:** 15% off the next order for any honest review, 20% with a pet photo, the same at every rating, disclosed
   with Judge.me's badge. The alternative is no incentive.
4. **Who sends the review request:** Judge.me, timed 20 days after payment, with Jake postponing delayed orders by
   hand. The alternative is our backend sending it, which gives exact timing but more code and weaker
   verified-purchase status.
5. **Texts:** not in v1. Revisit at about 100 orders a month. Keep Shopify's SMS checkbox off until then.
6. **Postal address for email footers** (required by CAN-SPAM in commercial email; shows in Judge.me footers): a PO box
   or virtual mailbox, not a home address.
7. **Ask refunded customers for a review too:** yes. Skip only cancelled or never-shipped orders. Excluding unhappy
   customers is the gating the FTC warns about.
8. **Optional, later: a Shopify Admin API token** so the backend can mark orders fulfilled with tracking. That lets
   Judge.me time requests from fulfillment and fixes Shopify-side order status. Not needed for v1.

## 8. Untested; check on the first real order
- Judge.me schedules a request from the **Paid** trigger on an order Shopify never marks fulfilled.
- Judge.me's email links don't land on the password-protected `shop.printpetz.com` theme.
- Judge.me can see our products after they're removed from the Online Store channel.
- Judge.me ignores Shopify test orders, or requests stay paused until launch.
- The pet image URL in the check-in loads in Gmail and Apple Mail.
- Judge.me's coupon codes work in our headless checkout's discount field.

## Sources
- FTC, Consumer Reviews and Testimonials Rule Q&A: https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers
- FTC, Soliciting and Paying for Online Reviews: A Guide for Marketers: https://www.ftc.gov/business-guidance/resources/soliciting-paying-online-reviews-guide-marketers
- FTC press release, final rule (Aug 2024): https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials
- Federal Register, 16 CFR 465: https://www.federalregister.gov/documents/2024/08/22/2024-18519/trade-regulation-rule-on-the-use-of-consumer-reviews-and-testimonials
- BrightLocal, review gating (Fashion Nova $4.2M): https://www.brightlocal.com/learn/review-gating/
- FTC, CAN-SPAM compliance guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- Google Business Profile eligibility: https://support.google.com/business/answer/7039811?hl=en
- Google Merchant Center, product ratings eligibility: https://support.google.com/merchants/answer/14549080?hl=en
- Google store ratings overview: https://support.google.com/merchants/answer/190657?hl=en
- Google, self-serving review snippets: https://developers.google.com/search/blog/2019/09/making-review-rich-results-more-helpful
- Trustpilot pricing: https://business.trustpilot.com/pricing
- Trustpilot guidelines for businesses: https://legal.trustpilot.com/for-businesses/guidelines-for-businesses
- Judge.me Shopify listing (plans): https://apps.shopify.com/judgeme
- Judge.me automatic review request emails (triggers, delays): https://judge.me/help/en/articles/8379844-automatic-review-request-emails
- Judge.me API (public vs private tokens; API reviews can't be verified): https://judge.me/help/en/articles/8409180-using-judge-me-api
- Judge.me verified status: https://judge.me/help/en/articles/8403775-verified-status-of-judge-me-reviews
- Judge.me coupons for reviews: https://judge.me/help/en/articles/8379747-offering-coupons-for-reviews
- Judge.me transparency badges: https://judge.me/help/en/articles/11136451-review-transparency-badges
- Judge.me publishing and moderation: https://judge.me/help/en/articles/8368681-publishing-and-hiding-reviews
- Judge.me custom sender: https://judge.me/help/en/articles/8282420-setting-up-your-custom-sender-email
- Judge.me Hydrogen package (headless): https://www.npmjs.com/package/@judgeme/shopify-hydrogen
- Shopify Product Reviews removal: https://www.ilanadavis.com/blogs/articles/shopify-product-reviews-app-unavailable-may-2024
- Okendo pricing: https://www.usestorepilot.com/blog/okendo-pricing/
- Yotpo pricing: https://ecommerceparadise.com/yotpo-pricing/
- Printful API v2 (shipments, delivered_at): https://developers.printful.com/docs/v2-beta/
- TCPA text consent (marketing vs informational): https://activeprospect.com/blog/tcpa-text-messages/
- 11th Circuit vacates one-to-one consent: https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule
- FCC revocation rule, partial delay: https://www.nixonpeabody.com/insights/alerts/2025/04/11/fcc-partially-delays-new-tcpa-consent-revocation-rules
- State quiet hours and frequency caps: https://justcall.io/blog/state-mini-tcpa-laws.html
- Twilio A2P 10DLC fees: https://support.twilio.com/hc/en-us/articles/1260803965530-Pricing-and-Fees-for-A2P-10DLC-Service
- Twilio SMS real cost: https://textbee.dev/blog/twilio-pricing-real-cost-breakdown
- Klaviyo SMS credits: https://www.omnisend.com/blog/klaviyo-pricing/
- Shopify SMS consent at checkout: https://changelog.shopify.com/posts/capture-sms-marketing-consent-in-shopify
