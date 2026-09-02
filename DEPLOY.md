# Deployment

Backend deploys to **AWS Elastic Beanstalk**, triggered automatically by
**AWS CodePipeline** watching `main`.

**Merging a PR to `main` ships to production.** There is no manual deploy step
and no approval gate. Treat a merge as a release.

The pipeline is configured entirely in AWS — nothing in this repo defines it,
which is why it isn't obvious from the source tree.

---

## Pipeline

| Stage  | Where | Notes |
| ------ | ----- | ----- |
| Source | GitHub `main`, this repo | Auto-triggers on merge |
| Build  | See [The build step](#the-build-step-unconfirmed) | **Unconfirmed** |
| Deploy | Elastic Beanstalk `<EB_APPLICATION>` / `<EB_ENVIRONMENT>` | |

Fill in for your account:

- Pipeline: `<PIPELINE_NAME>`
- Region: `<REGION>`
- EB application: `<EB_APPLICATION>`
- EB environment: `<EB_ENVIRONMENT>`

---

## The build step (UNCONFIRMED)

> **This section is a known gap.** Everything else here is verified against the
> repo; this part is reasoned from evidence but not confirmed against the AWS
> console. Confirm it and replace this block.

The app starts with `node lib/index.js`, but **`lib/` is gitignored** — see the
`lib/` entries in `.gitignore`. A source artifact pulled from GitHub `main`
therefore contains **no compiled JavaScript**.

Nothing in this repo compiles it:

- no `buildspec.yml`
- no `Procfile`
- no `postinstall` / `prebuild` npm lifecycle hook
- no `.platform/hooks/` scripts (only `.platform/nginx/`)

The EB Node.js platform runs `npm install` then `npm start`; it does **not** run
build scripts. So something between GitHub and EB must run `npm run build`, or
the deploy would fail with `Cannot find module '/var/app/current/lib/index.js'`.

Since deploys succeed, that step exists — it just isn't in this repo.

### How to find it

1. AWS Console → **CodePipeline** → `<PIPELINE_NAME>` → view stages.
2. **If a Build stage exists:** open the CodeBuild project → **Buildspec**.
   Note whether it's *inline* (defined in the console) or a *file* (and where
   that file lives). Record the install/build commands and the artifact paths.
3. **If there is no Build stage:** the compile happens on the instance. Check
   the EB environment's **saved configuration** for container commands, or look
   for platform hooks baked into a custom AMI.

Then replace this section with what you found.

### Worth fixing

The build being invisible to the repo is the reason deployment was a mystery.
Two options, either of which makes it self-documenting:

- Commit a `buildspec.yml` and point the CodeBuild project at it.
- Add a `postinstall` script that runs `tsc`, so EB compiles on the instance and
  `lib/` never needs to travel in an artifact.

---

## What Elastic Beanstalk runs

- **Start command:** no `Procfile`, so the platform falls back to `npm start` →
  `node lib/index.js`.
- **Path aliases:** `module-alias` maps `@` → `lib` at runtime, via
  `_moduleAliases` in `package.json`. `src/index.ts` imports
  `module-alias/register` first.
- **Node version:** `engines.node` is `22`.
- **nginx:** `.platform/nginx/conf.d/proxy.conf` raises the request body limit to
  `1000M` and all proxy timeouts to `600s` — needed for large pet-photo uploads
  and long-running FLUX training calls. Deployed automatically as a platform
  hook.

### Two things that will break the environment

**Never set `PORT` in EB environment properties.** The platform sets
`PORT=8080` and nginx proxies there. `AppConstants.port` falls back to `81` only
when unset, so an explicit wrong value produces a 502 across the whole
environment.

**`public/` must exist at the deployed application root.** `src/app.ts` uses
`express.static(path.join("public"))` — a *relative* path resolved from the
process working directory, not from `__dirname`. If a build artifact omits
`public/`, static routes and `/favicon.ico` break.

---

## Environment variables

All 17 are set in **EB → Configuration → Software → Environment properties**.
They are not in this repo — `.env` is gitignored and no committed example exists.

| Group | Variables |
| ----- | --------- |
| Supabase | `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL` |
| AWS S3 | `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_BUCKET` |
| fal.ai | `FAL_API_KEY` |
| Stripe | `STRIPE_API_KEY`, `STRIPE_CHECKOUT_WEBHOOK_SECRET`, `STRIPE_PRICE_CHANGE_WEBHOOK_SECRET` |
| Email (Resend) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_FROM` |
| URLs | `CLIENT_BASE_URL`, `SERVER_BASE_URL` |
| Runtime | `NODE_ENV`, `PORT` *(set by the platform — do not override)* |

`EMAIL_FROM` takes precedence over `RESEND_FROM_EMAIL`; either satisfies the
sender requirement. If neither is set, email is skipped and logged as
`EMAIL_CONFIG_MISSING` rather than throwing.

### Config that is hardcoded, not environment-driven

Changing any of these requires a code change and a deploy:

- **S3 region** `us-east-1` — `src/services/aws_service.ts:11`
- **CloudFront domain** `https://d155jdfit5sgy.cloudfront.net` —
  `src/constants/app_constants.ts:18`
- **Credit costs** `modelTrainingCredit = 30`, `imageGenerationCredit = 2` —
  `src/constants/app_constants.ts`

---

## Database migrations — NOT part of the pipeline

**CodePipeline does not touch Supabase.** Migrations are applied by hand, and
nothing verifies they ran.

`supabase/` is **not** a Supabase-CLI-managed project — there is no
`config.toml` and no linked project ref. The files under
`supabase/migrations/` are hand-written records of changes applied manually, not
a migration history the CLI tracks. `supabase db push` will not do the right
thing here as currently set up.

### Order of operations

**Apply the migration first, then merge the code.** Additive nullable columns
are backward compatible in both directions — currently deployed code ignores a
column it doesn't know about, and new code needs it present. There is no window
where either version breaks.

### Applying one

Supabase dashboard → **SQL Editor** → paste the migration file → Run.

Check first whether it's already applied:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = '<TABLE>'
  and column_name = '<COLUMN>';
```

Zero rows means it hasn't been applied. Migrations written with
`add column if not exists` are safe to re-run either way.

### A failure mode to know about

A missing column **fails silently on reads and loudly on writes**.

Reads use optional chaining with a fallback — for example
`model.pet_name?.trim() || model.name` in `src/controllers/generation_controller.ts`
and `src/services/model_service.ts`. A missing column yields `undefined` and
falls back with no error, producing subtly wrong output rather than a crash.

Writes fail hard: inserting a nonexistent column returns Postgres `42703`,
which surfaces as an `ADD_MODEL` entry in the error log and a null return.

So **"production isn't erroring" is not evidence a migration was applied.** Check
`information_schema` directly.

### If adopting the Supabase CLI later

Existing filenames use an 8-digit date (`20260830_add_pet_name_to_models.sql`).
The CLI expects a 14-digit `YYYYMMDDHHMMSS` timestamp. Rename before the first
CLI-managed migration or the ordering will be wrong.

---

## Verifying a deploy

1. **EB → Events** — wait for deployment success.
2. **Health** — should return to **Ok**, not Degraded or Severe.
3. Hit a lightweight endpoint via `SERVER_BASE_URL`.
4. **Train a model end-to-end.** This is the real smoke test: it exercises the
   Supabase insert path, S3 upload, the fal.ai webhook, and the completion
   email. A green EB health check alone proves only that the process booted.

---

## Rollback

**Preferred:** EB → **Application versions** → select the previous label →
**Deploy**. Fastest path, no pipeline run.

**Alternative:** revert the merge commit on `main`, which re-triggers the
pipeline and takes a full build cycle.

Check whether the release included a migration. Additive nullable columns need
no database rollback — older code ignores them. A destructive migration (dropped
or renamed column, narrowed type) must be reversed separately and by hand.

---

## Building locally

Reproduces what the pipeline produces, for debugging artifact problems:

```bash
npm install
npm run build     # tsc → lib/
npm start         # node lib/index.js
```

Requires a local `.env` with the variables above. `npm run build` must succeed
before merging — a compile error becomes a failed deploy, not a failed PR, since
there is no CI.

---

## Known gaps

- **No CI.** Nothing runs `tsc`, `eslint`, or tests on a PR. The first
  verification a change gets is the deploy itself.
- **No tests.** `npm test` is a placeholder that exits 1.
- **The build step is undocumented** — see above.
- **`README.md` is stale.** It points at a different repository
  (`JaydeepSeemflow/printpetz_backend`), says port 80 while `AppConstants.port`
  defaults to 81, and says `npm build` instead of `npm run build`.
- **Static IAM credentials.** `AWS_ACCESS_KEY` / `AWS_SECRET_KEY` are long-lived
  keys in environment properties rather than an EC2 instance role.
- **Dependency vulnerabilities.** `npm install` reports 42 advisories
  (3 critical, 17 high) in the existing tree.
