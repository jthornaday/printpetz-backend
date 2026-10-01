# Free starter credits + watermark

Decided by Jake on 2026-10-01. The design is by the architect agent.

## Decisions

- New accounts get **40 free starter credits**: one pet (30) plus 5 images (2 each).
- Any image paid for even partly with free credits is **watermarked** wherever the customer sees
  or downloads it.
- **Products always print clean**, from the stored original.
- On the customer's **first credit purchase, all their watermarked images unlock** (option b).

## Design

### Two balances, spent atomically
- Add `users.free_credits int not null default 0`. It is spent before `credits`.
- All spending goes through one Postgres function, `spend_credits(uid, amount)`, a single
  `UPDATE … WHERE free_credits + credits >= amount RETURNING …`. It returns `free_spent`.
  `refund_credits(uid, free, paid)` puts credits back in the bucket they came from.
- This also fixes today's race. `updateUserCredit` (`src/services/user_service.ts:99-111`) reads
  the balance, then writes it back from JS, so parallel requests lose updates.
- Call sites that must move onto the functions:
  - `model_controller.ts:38`
  - `model_service.ts:194` (training refund)
  - `generation_controller.ts:283, 394, 507`
  - `generation_service.ts:348`
  - `generation_worker.ts:65`
- The queued lane charges *after* inserting rows. Charge first, then refund any rows that fail.

### Where the clean original lives
- For a free image, store the clean original at `originals/{uuid}.png`. Only the server reads
  it, via `getObjectFromS3`. Never derive this key from the public one.
- `generations.image` holds the **watermarked** copy at the usual `generations/` key. The cart
  and `isOurGenerationUrl` keep working unchanged.
- The original's key and `free_spent` go in a new table, `generation_assets`. It has RLS on and
  no policies, so only the server can read it. They can't go on `generations`: the frontend
  reads that table with `select("*")`.
- Optional hardening for Jake: a CloudFront rule that blocks `/originals/*`.

### Shop, orders, editor
- **Shop previews** are built from the clean original, so the crop matches the print. The
  preview and mockup outputs get a light watermark, cached under a `-wm` key, with the caption
  "Prints without watermark."
- **Order webhook:** require `_generation_id` for every product and check that
  `generation.image === _generation_url`. Today that check runs only for band products
  (`printful_service.ts:136`). Then print from the clean original.
- **Edit-look and remove-background** today take any URL, charge nothing and return a raw fal
  URL. Change them to take a `generationId`, edit the clean source on the server, and
  watermark and store the result if the source image was free.

### Unlock on first purchase
- After the Stripe checkout completes and paid credits are added, if this is the user's first
  purchase, re-publish each watermarked image's clean original to its public key. Set
  `generation_assets.unlocked_at`.
- Shop previews are re-rendered, because their cache key includes the watermark state.

### Watermark look
- A tiled diagonal "PrintPetz" wordmark in white at about 18% opacity, with a thin dark
  outline, so it reads on both black and white coats. Because it covers the whole image it
  can't be cropped out.
- A small royal-blue "printpetz.com" badge in one corner.
- Keep it light over the face. Check it on Wizard (black) and Darla.

## Order of work
1. **Migration (Jake runs it):**
   - add `free_credits`;
   - create `generation_assets`;
   - create `spend_credits` and `refund_credits`;
   - stop the browser from updating credit columns. This depends on the current `users` RLS
     policies, so read them first.

   Harmless on its own, because everything defaults to 0.
2. **Backend PR 1:** move every charge and refund onto the functions.
3. **Backend PR 2:** a watermark utility, plus one image-storing function used at all three
   upload points (the sync path, the worker, and the fal webhook).
4. **Backend PR 3:** previews, the order webhook and the editor all use the clean source.
   Unlock on first purchase.
5. **Frontend PR:**
   - show the free and paid balances;
   - the editor sends `generationId`;
   - the preview caption;
   - a "watermark removed when you buy credits" note.
6. **Last, Jake:** the signup trigger grants `free_credits = 40`.

## Risks
- **Self-set credits:** if RLS lets a user update their own `users` row, anyone can set their
  own credits. Fix this in step 1, before any free credits exist.
- **Server key:** the backend must use the service-role key to read `generation_assets`.
  Locally it is an `sb_secret_…` key. Confirm production uses the same kind.
- **Account farming:** people opening many accounts for 40 credits each, which is real OpenAI
  spend. Email verification slows it. Revisit if abused.
- **Deploy order:** merging to main deploys immediately. The migration goes first, the trigger
  change last.
