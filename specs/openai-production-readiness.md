# Making the OpenAI lane customer-ready — parent spec

## Goal
Close the two gaps that stand between "GPT-Image-2.5 won the bakeoff" and "a new customer can sign up and use it".

## The two gaps

| | milestone | why it blocks | urgency |
|---|---|---|---|
| 1 | [openai-generation-queue](openai-generation-queue.md) | The OpenAI lane blocks one HTTP request for the whole batch. A dropped connection means the customer is charged for images they never see. | **Live bug today** |
| 2 | [my-pets-saved-records](my-pets-saved-records.md) | A saved pet can only be created by training a LoRA. With OpenAI there is no LoRA, so there is no way to add a pet at all. | Blocks signup |

**Do milestone 1 first.** It is an active defect — it charged Jake 12 credits for nothing on 16 Sept — and milestone 2 has no value until generation is reliable. Milestone 1 is also the smaller of the two.

## Decisions made (do not relitigate)

**Every pet uses the reference lane.** Existing LoRA-trained pets included — they already carry `training_images`, and the 15 Sept backfill made those sRGB. FAL stays as a rollback via `PRINTPETZ_IMAGE_PROVIDER=fal`, not as a per-pet route. `model_path` stays on the row, unused.

This is already how the code behaves: `createImage` picks the lane from the env var, not from the pet. So "migrate existing pets" needs **no routing code** — it is the current behaviour. What it does mean is that the FAL lane must keep working untouched as the rollback, and nothing may assume `model_path` is populated.

**Adding a pet becomes free and instant.** No training, no 30-credit charge, no wait, no email. Revenue stays entirely on generation at 2 credits per image.

**The OpenAI lane moves to a queued shape** — `createImage` returns immediately, a paced in-process worker does the work, the frontend polls exactly as it does for FAL.

## What is NOT decided yet
- Whether stuck rows from 16 Sept need a refund pass. Gated on the `generations` query in milestone 1's Context — run it before deciding.

## Out of scope for both
- Removing the FAL lane. It is the rollback and must stay working.
- Changing generation pricing (2 credits/image).
- Re-running the bakeoff. The decision is made.
- The `www` vs apex redirect, and any other open incident work.
