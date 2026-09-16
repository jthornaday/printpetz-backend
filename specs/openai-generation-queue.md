# Make the OpenAI lane return immediately

## Goal
Requesting images returns in under a second and the frontend shows them as they finish, instead of holding one HTTP connection open for minutes and charging for images the customer never sees.

## Done when
- [ ] `POST /generation/create` with 4 images on the OpenAI lane responds in **under 2 seconds**, with 4 rows the frontend can poll.
- [ ] Those 4 images appear on the page without a manual refresh, and appear even if the tab is closed and reopened mid-batch.
- [ ] Killing the browser tab immediately after requesting still produces 4 completed images, and the credit charge matches the number that succeeded.
- [ ] Restarting the EB app mid-batch leaves no row stuck: anything unfinished ends as `ERROR` with credits refunded, within one sweep interval.
- [ ] A second submission while a batch is still running is refused with a clear message rather than charged.
- [ ] The FAL lane is byte-for-byte unchanged in behaviour — same response shape, same timing, same polling.
- [ ] `npm run build` and `npx tsc --noEmit` clean.

## Context

**What happens today.** `createImage` runs every requested image through `Promise.all` and awaits them all before responding. That was right for FAL, where `fal.queue.submit` returns a request id in milliseconds and a webhook finishes the row. OpenAI is synchronous and each image took **21–84 s** in the bakeoff, so a 4-image batch holds the connection for minutes. Node does not abort the handler when the client disconnects, so the work completes, rows are written, credits are charged — and the customer sees nothing, because `refetchGenerationViews()` in `Create/index.tsx` only runs after `await generateImage(...)` resolves.

**There is no pacing in production.** `provider-bakeoff.ts` throttles itself to `PRINTPETZ_OPENAI_IMAGES_PER_MINUTE` (default 5) and succeeded 52/52 partly because of it. `openai_provider.ts` has no equivalent — `Promise.all` fires N concurrent calls at a tier-1 limit of 5 images/minute, so 429s and backoff are expected, not exceptional. Whatever replaces the current shape must pace.

**Existing pieces to reuse, not rebuild:**
- `EGenerationStatus` already has `PENDING` — currently unused by the OpenAI path.
- The FAL webhook already implements exactly the semantics needed on failure (`generation_service.ts:201`): mark the row `ERROR` and `updateUserCredit(user_id, imageGenerationCredit, true)` to refund. Reuse that, do not write a second one.
- The frontend already polls for FAL generations. Confirm it treats `PENDING` like `GENERATING`; if it filters on `GENERATING` specifically, that is a one-line frontend change and belongs in this milestone.

**Run this before starting** — it decides whether a refund sweep is needed for 16 Sept and whether Jake's stuck images exist:
```sql
select group_id, count(*) as images,
       count(*) filter (where status='COMPLETED') as completed,
       count(*) filter (where status='ERROR')     as failed,
       count(*) filter (where image is not null)  as have_image,
       min(created_at) as started
from public.generations
where model_id = 27
group by group_id order by min(created_at) desc limit 5;
```

## Constraints
- Single EB instance, in-process worker. No SQS, no second service.
- The worker must survive nothing: assume the process can die at any moment and design the sweep accordingly.
- Do not change the FAL lane's code path.
- Any new column needs a SQL file for Jake to run, gated the same way `PRINTPETZ_PROVIDER_COLUMNS` is — Supabase rejects inserts naming columns that do not exist, so unguarded writes fail every generation on a deploy that beats the SQL.

## Free-edit files
- `src/controllers/generation_controller.ts`
- `src/services/generation_service.ts`
- `src/services/generation_worker.ts` (new)
- `src/index.ts` (to start the worker)
- `/tmp/ppfe` frontend: `src/components/pages/Create/index.tsx` and the polling hook, if `PENDING` needs handling

Anything else asks first.

## Out of scope
- Removing or altering the FAL lane.
- Multi-instance coordination. One instance today; a row-level claim is enough.
- Retrying failed generations automatically.
- Changing what a generation costs.

## Approach (suggested, not mandatory)
- `createImage` builds the prompts, inserts N rows as `PENDING`, and returns them immediately. No provider call on the request thread.
- A worker loop in the same process claims `PENDING` rows oldest-first, one at a time, paced to `PRINTPETZ_OPENAI_IMAGES_PER_MINUTE` (default 5). On success: upload to S3, row `COMPLETED`. On failure: row `ERROR`, refund.
- **Claim rows atomically.** `update ... set status='GENERATING' where id = ? and status='PENDING'` returning the row, so a double-started worker cannot process one row twice.
- **Sweep on boot and on an interval:** any row `PENDING` or `GENERATING` older than a threshold (say 15 minutes) becomes `ERROR` with a refund. This is what makes a mid-batch restart safe, and it is also the cleanup pass for anything stranded on 16 Sept.
- **Double-submission guard:** refuse a new batch while the same user has unfinished rows, with a 409 and a message the UI can show. The Create page resets `numberOfGenerations` to its default of 2 on refresh, so a refresh-and-retry is a realistic path to a second charge — that is very likely what made Jake's charge 12 rather than 8.

**Sharpest risk:** credit timing. Today the OpenAI lane charges only for images that succeed, which is the better customer experience — no balance dip and rebound. Once work moves to a worker, the natural options are (a) debit upfront and refund failures, matching FAL exactly and reusing its refund path, or (b) debit per image as it completes, preserving today's semantics but allowing a customer to queue work they can no longer afford. **Recommend (a)** — one billing model in the codebase, no overdraft, and the refund path already exists and is proven. Flag it to Jake before implementing; it is a visible behaviour change either way.

## House rules
- STOP at forks only (unexpected number, broken done-when, API spend, anything irreversible). Always STOP before any commit, push, or delete.
- Ask before touching credentials, .env files, secrets, or any production database.
- Prefer the simplest thing that passes every "Done when" check. Eliminate redundancy; do not add features not listed above.
- If a "Done when" check turns out to be impossible or wrong, stop and say so rather than working around it.
- Finish by running through the "Done when" list and reporting pass/fail on each.

## Kick-off prompt
Read specs/openai-generation-queue.md and execute it. Follow the House rules exactly.
