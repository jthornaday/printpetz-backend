---
applicable: yes
---

# PrintPetz — agent context

AI pet-image generator: puts a customer's real pet into sports, role, and themed poses.
Not launched yet; the blocker is image quality, not features.

**Read `CLAUDE.md` (this repo) and `../CLAUDE.md` (workspace root) first.** They hold the
authoritative stack map, generation-pipeline detail, and house rules. This file only adds
the agent-facing framing.

## Where the code actually lives

```
~/Documents/PrintPetz_Github_Master/
  printpetz-backend/        <- this repo (Express + TS, AWS Elastic Beanstalk)
  printpetz-frontend/       <- Next.js 15, AWS Amplify
  printpetz_backend_stale/  <- DEAD. Never read for truth, never edit.
  *.zip                     <- old deploy packages, ignore
```

Older notes referred to `~/printpetz-backend` and `~/Documents/GitHub/printpetz-frontend`.
Those paths are obsolete — the master workspace above is the only live copy.

## For `engineer`

- Stack: Express + TypeScript (`src/` → `lib/`, alias `@/` → `lib/`). Supabase for DB/auth
  (styles, base_prompts, users, credits). S3 for image storage. Stripe (**test mode**).
  Resend for email, sender `hello@send.printpetz.com` (`RESEND_FROM_EMAIL`).
- Image generation goes through a provider abstraction (`src/services/providers/`), selected
  at call time by `PRINTPETZ_IMAGE_PROVIDER`. **Code default is `fal`**; `openai`
  (`gpt-image-2.5-flare`) is the other lane. An unrecognized value falls back to fal with a
  warning. Switching lanes in Elastic Beanstalk takes effect on restart — no deploy needed.
  Confirm which lane production is actually on before drawing conclusions.
- Production database: Supabase (production project). There is no staging.
- Deploy: AWS CodePipeline `CIPrintpetz`: GitHub `main` → CodeBuild → Elastic Beanstalk.
  **Merging to main ships straight to production.** See `DEPLOY.md` (resource names are
  placeholders — the repo is public).
- Local runs do NOT match production config (e.g. `PRINTPETZ_*_POSE_REFERENCES` unset
  locally). Check the EB environment before concluding anything from a local run.
- Never commit, push, or merge. Build, verify, write up, hand Jake the commands.

## For `studio-manager`

- Core loop: upload pet photos (3 minimum) → model training → generate → style
  (Natural / Mascot / Cartoon) → credits → Stripe checkout → confirmation email → History.
- Quality dimensions: identity match, coat color, anatomy (leg count, paws, muzzle, body
  proportions), style accuracy, theme/apparel accuracy, pet display name on apparel
  (and no invented lettering or branding).
- Regression pets: Wizard (black cat — must stay black), Moses (six-legs case),
  George (muzzle + display name + paws), Max (brand benchmark), Darla (known-good).
- Growth priorities: none until launch. Image quality first.
- Known issues: GitHub issues on `jthornaday/printpetz-backend`; see `GENERATOR-STATE.md`
  and `TEST-MATRIX.md` for the latest survey.
