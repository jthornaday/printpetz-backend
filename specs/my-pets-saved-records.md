# A saved pet without a trained model

## Goal
A customer can add a pet from photos in seconds, for free, and generate with it — with no LoRA, no wait, and no email that never arrives.

## Done when
- [ ] Adding a pet takes **under 10 seconds end to end** and charges **0 credits**.
- [ ] The new pet generates images immediately, with no `TRAINING` state and no "we'll email you" screen.
- [ ] A customer can add photos to an existing pet and remove ones they no longer want, and the next generation uses the updated set.
- [ ] Every pet created before this change still generates exactly as it does today.
- [ ] Uploading a HEIC or Display P3 photo when adding a pet is handled by the existing upload conversion — sRGB JPEG in S3, HEIC refused with the existing message.
- [ ] Nothing in the app shows a training wait, a training cost, or a training email for a pet created this way.
- [ ] `npm run build` and `npx tsc --noEmit` clean.

## Context

**Today a pet can only be born by training one.** `model_controller.trainModel` is the sole path that produces a `models` row: it charges `modelTrainingCredit` (30) unconditionally, calls `handleTrainModel` to start a FAL LoRA, and inserts with `status: TRAINING`. There is no way to create a pet without that, which is why OpenAI-only signup is impossible right now.

**What already works in our favour:**
- `models.training_images` (`text[]`) and `models.pet_description` already exist and are already populated. The reference lane reads exactly these — nothing new is needed to *identify* a pet.
- `createImage` already guards the trigger word: `lane === "reference" ? "the pet" : getModelTriggerWord(...)`. **The OpenAI lane never touches `model_path`**, so a pet with a null `model_path` generates fine today. This is a smaller change than it first looks.
- `POST /file/upload?type=TRAINING_IMAGE` already converts to sRGB and refuses HEIC (PR #36). The add-a-pet flow should use it unchanged.

**What breaks or lies today:**
- `EModelStatus` has no state meaning "ready, never trained". A new pet needs `COMPLETED` from birth.
- `ModelTrainingDialog/RequestSubmitted` says *"Fast training is underway. Most pets are ready in about 2–3 minutes… we'll email you as soon as your model is ready."* None of that happens on the reference lane.
- Nothing lets a customer edit an existing pet's photos.
- `sendModelReadyEmail` fires from the FAL training webhook only, so it is not wrong — it simply never runs. Leave it alone.

## Constraints
- **Do not break existing FAL pets.** They are the rollback path; `PRINTPETZ_IMAGE_PROVIDER=fal` must still produce identical results for them.
- Keep `trainModel` working and reachable. It is not the default path any more, but removing it removes the fallback.
- Do not change generation pricing.
- Any schema change needs a SQL file for Jake to run, env-gated the same way `PRINTPETZ_PROVIDER_COLUMNS` is.
- Milestone 1 ([openai-generation-queue](openai-generation-queue.md)) should be merged first. Not a hard dependency, but shipping "add a pet" on top of a generation path that strands customers mid-batch is not worth doing.

## Free-edit files
- `src/controllers/model_controller.ts`
- `src/services/model_service.ts`
- `src/router/model_router.ts`
- `src/utils/validation/model_training_validation_schema.ts`
- `src/types/model.ts`
- `/tmp/ppfe` frontend: `ModelTrainingDialog/*`, `ModelSelector/*`, `src/store/api/modelApi.ts`

Anything else asks first.

## Out of scope
- Deleting or disabling the FAL training path.
- Retraining or migrating existing pets. They already carry `training_images`; nothing to move.
- Re-uploading or re-converting existing photos. The 15 Sept backfill did that.
- A pet-sharing or multi-user feature.
- Changing what a generation costs.

## Approach (suggested, not mandatory)
- Add `POST /model/create` (or a `train: false` branch on the existing endpoint — pick one and say which): validate name, photos and description, insert with `status: COMPLETED`, `model_path: null`, `request_id: null`, charge nothing.
- Add `PATCH /model/:id` for adding and removing reference photos, scoped to the owning user. Re-use the existing upload endpoint for the photos themselves so conversion and HEIC rejection come for free.
- Enforce a sane photo count — the provider caps references at 10 and sends 5 by default (`PRINTPETZ_OPENAI_REF_COUNT`). Require at least 3; the 13 Sept finding was that three dim photos produce a bobble-head, and that lever is now the *only* identity lever left.
- Frontend: replace the training dialog's submit-and-wait with an immediate save. The "2–3 minutes / we'll email you" screen goes away entirely for this path.
- Leave `EModelStatus.TRAINING` in place for the FAL path.

**Sharpest risk:** reference photo quality is now the whole of identity fidelity. With a LoRA there was a training step that partly compensated for weak input; with references there is nothing between the customer's photos and the output. The 13 Sept log already records this — *"training photos are the biggest per-pet lever"* — and the LoRA-scale A/B later confirmed there is no weighting knob left to compensate with. Whatever guidance the old upload flow gave about photo quality should get **stronger** here, not quietly disappear along with the training step.

## House rules
- STOP at forks only (unexpected number, broken done-when, API spend, anything irreversible). Always STOP before any commit, push, or delete.
- Ask before touching credentials, .env files, secrets, or any production database.
- Prefer the simplest thing that passes every "Done when" check. Eliminate redundancy; do not add features not listed above.
- If a "Done when" check turns out to be impossible or wrong, stop and say so rather than working around it.
- Finish by running through the "Done when" list and reporting pass/fail on each.

## Kick-off prompt
Read specs/my-pets-saved-records.md and execute it. Follow the House rules exactly. Milestone 1 (specs/openai-generation-queue.md) should already be merged.
