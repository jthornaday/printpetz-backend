# Hide deleted pet models from the picker

## Goal
A model soft-deleted via `DELETE /model/:id` (PR #46) stops appearing in the user's model picker, while their past generations and History keep working.

## Done when
- [ ] After deleting a model, it no longer appears in the picker (frontend query returns only `is_deleted = false` rows).
- [ ] Every frontend query that lists models for the user filters `is_deleted = false`. (No RLS change — decision made, see Decision.)
- [ ] History still renders generations made from a deleted model (pet name/model label included, if History reads it) — no blank cards, no errors.
- [ ] Backend paths still work: training webhook (`getModelByRequestId`), `POST /generation/create` (404 for a deleted model), model-ready email. No backend change is expected.
- [ ] Verified on a real, non-critical test model (e.g. "Max test 5"), not hypothetically: delete it, reload the picker, confirm it's gone, confirm an older generation still shows in History and downloads.
- [ ] Frontend build/lint clean.

## Context
- `is_deleted` is live on `models` in production and is set by `DELETE /model/:id` (PR #46). Nothing filters it on the read side the picker uses.
- Jake confirmed the frontend picker queries Supabase directly (RLS-gated), not through this backend. No model-listing endpoint exists here.
- RLS is intentionally left alone (Option A); this is a frontend-only change.
- Frontend repo: `~/Documents/GitHub/printpetz-frontend` (not connected in the session that wrote this spec — connect it or confirm the path first). Find every place that queries `models`, not just the picker (History, checkout, account pages may too).
- Check that no screen (History, etc.) reuses the picker's query in a way that would drop a deleted model's name/label for past generations — the filter belongs on the picker/list queries only, not on lookups by id for existing generations.

## Decision (made by Jake)
**Option A — frontend filter only.** Add `.eq("is_deleted", false)` to every picker/list query. No RLS policy or migration. Deleted rows remain readable through the API; that's accepted. Option B (RLS) is out of scope.

## Constraints
- Every prompt carries: "Do not merge. Do not run SQL against production. Do not delete files."
- No RLS change and no migration.
- Do not touch `.env`, credentials, or production data without asking.

## Free-edit files
- Frontend: the query/hook(s) that load models for the picker (locate first).

## Out of scope
- Hard-deleting rows or purging training photos/S3.
- Hiding or cascading to past generations.
- A delete button/UI in the frontend (separate spec unless it already exists).
- Restore/undelete.
- Any RLS policy change.

## House rules
- STOP at forks only (unexpected number, broken done-when, API spend, anything irreversible). Always STOP before any commit, push, merge, or delete.
- Ask before touching credentials, .env files, secrets, or any production database.
- Prefer the simplest thing that passes every "Done when" check. Eliminate redundancy; do not add features not listed above.
- If a "Done when" check turns out to be impossible or wrong, stop and say so rather than working around it.
- Finish by running through the "Done when" list and reporting pass/fail on each.

## Kick-off prompt
Read specs/hide-deleted-models-in-picker.md and execute it. Follow the House rules exactly.
