# printpetz-backend

Express + TypeScript API for PrintPetz. Read `../CLAUDE.md` first for product rules
(identity standard, regression pets, hard gates). This file is the backend map.

## Stack

- Node + Express, TypeScript (`src/` → compiled to `lib/`, `main: lib/index.js`)
- Path alias `@/` → `lib/` (module-alias). Import as `@/services/...`.
- Supabase — DB + auth. Tables declared in `src/supabase/tables.ts`.
- Image generation — provider abstraction, `src/services/providers/`
- AWS S3 for image storage, Stripe for payments (**still test mode, `sk_test_`**), Resend for email
- Deploy: AWS CodePipeline `CIPrintpetz` → GitHub `main` → CodeBuild → Elastic Beanstalk.
  **Merging to main ships to production.** See `DEPLOY.md`.
- No staging environment. `main` is production.

## Commands

```
npm run build        # tsc — run this before claiming anything compiles
npm run build:watch
npm run dev          # nodemon lib/index.js (needs a build first)
npm run lint
```

Local config does **not** match production (e.g. `PRINTPETZ_*_POSE_REFERENCES` are
unset locally). Never conclude anything about production behavior from a local run —
check the EB environment config.

## The generation pipeline — where to look

```
src/controllers/generation_controller.ts   # entry, seed assignment
src/services/generation_service.ts         # orchestration
src/services/generation_worker.ts          # async job lane
src/services/providers/index.ts            # provider selection (env-driven)
src/services/providers/fal_provider.ts     # fal.ai lane
src/services/providers/openai_provider.ts  # OpenAI lane (default model gpt-image-2.5-flare)
src/services/fal_service.ts                # the actual fal call, endpoint selection
src/utils/prompt_variants.ts               # prompt assembly / variants
src/utils/role_blueprints.ts               # theme/role definitions
src/utils/pose_references.ts               # pose reference images per sport
src/utils/model_utils.ts                   # isFluxModel detection
src/constants/prompts.ts                   # legacy — issue #16 wants this removed
```

Provider is chosen at call time by `PRINTPETZ_IMAGE_PROVIDER` (`fal` | `openai`),
**defaults to `fal`**, unknown values fall back to `fal` with a warning.
Changing it in EB takes effect on restart, no deploy needed.

On the fal lane, endpoint selection in `fal_service.ts` is:

```
pose reference exists for this style  → fal-ai/flux-general
isFluxModel, no pose reference        → fal-ai/flux-lora   (+ acceleration: "regular")
otherwise (legacy)                    → fal-ai/qwen-image
```

A pose reference exists only when the style name matches an alias **and** the matching
env var is populated. Sports have them; astronaut/chef/doctor/police/firefighter/pilot
do not — so those run a different endpoint than baseball does. This asymmetry is the
source of a lot of "why does baseball look different" confusion.

## Prompt architecture

Prompts are assembled modularly: identity block → identity-preservation rules → style
block → theme block → pose/composition → background → personalization (display name) →
negative constraints → variation.

Global identity rules live in one place on purpose. **Do not duplicate identity
instructions into individual theme prompts** — fix the shared layer instead.

Known live problem: the assembled baseball prompt is ~940–1000 words, likely 2–3x over
FLUX's T5 token limit (issue #23). Truncation there is the suspected root cause of
coat drift, missing display names, and ignored themes. Check this before blaming a theme.

## Env vars (names only — values live in EB / .env, never commit them)

```
SUPABASE_URL, SUPABASE_KEY, SUPABASE_DB_URL
FAL_API_KEY, OPENAI_API_KEY
PRINTPETZ_IMAGE_PROVIDER, PRINTPETZ_OPENAI_MODEL, PRINTPETZ_OPENAI_SIZE,
PRINTPETZ_OPENAI_QUALITY, PRINTPETZ_OPENAI_IMAGES_PER_MINUTE
PRINTPETZ_FIXED_SEED, PRINTPETZ_FAL_COST_PER_IMAGE, PRINTPETZ_PROVIDER_COLUMNS,
PRINTPETZ_STRANDED_AFTER_MS, PRINTPETZ_TRADEMARK_MODEL
AWS_ACCESS_KEY, AWS_SECRET_KEY, AWS_BUCKET
STRIPE_API_KEY, STRIPE_CHECKOUT_WEBHOOK_SECRET, STRIPE_PRICE_CHANGE_WEBHOOK_SECRET
RESEND_API_KEY, RESEND_FROM_EMAIL, EMAIL_FROM
CLIENT_BASE_URL, SERVER_BASE_URL, PORT, NODE_ENV
```

Resend sender: `hello@send.printpetz.com`. Email has historically failed silently —
generation completes and credits decrement but no email arrives. Debug from backend
logs and Resend logs, not frontend symptoms.

## Business rules that are easy to break

- Never charge credits for a **failed or malformed** generation. Customer creative
  re-rolls are chargeable; our bugs are not.
- Credits decrement on generation **success**, transactionally.
- No invented lettering, team names, or branding on apparel — only the pet's display name.
- Never make a generated pet resemble a real named human athlete.
- The image editor edits the existing asset. It must **never** re-invoke generation.
- HEIC uploads: if decode fails we pass the original bytes through rather than 400.
  See `src/utils/image_conversion.ts` and `specs/heic-decode-diagnostics.md`.

## Before you say a fix works

1. `npm run build` clean.
2. Generate multiple images across the regression pets in `../CLAUDE.md`.
3. Check: identity, coat color, limb count, muzzle, paws/hands, theme applied,
   display name correct, no invented branding.
4. Update `TEST-MATRIX.md` / write findings down.
5. Then hand Jake the commit + push commands. Do not run them yourself.

Open issues are tracked on GitHub `jthornaday/printpetz-backend`.
