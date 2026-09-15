-- PrintPetz — record which provider and model made each generation
-- Generated 2026-09-14. NOT run by Claude. Review, then apply in Supabase.
--
-- Additive and safe: two nullable text columns, no rewrite of existing rows,
-- no constraint that existing rows could violate. provider defaults to 'fal'
-- so anything inserted from here on is labelled even if the code forgets to.
--
-- DEPLOY ORDER MATTERS, and the code is built so it cannot bite you:
--   1. Run this file.
--   2. Deploy the code.
--   3. Set PRINTPETZ_PROVIDER_COLUMNS=true in Elastic Beanstalk and restart.
--
-- Until step 3 the app does not write these columns at all. That is deliberate.
-- Supabase rejects an insert naming a column that does not exist, so code that
-- wrote them before this file ran would fail EVERY generation, not just the
-- OpenAI ones. The flag makes the wrong order impossible rather than merely
-- discouraged.

begin;

alter table public.generations
  add column if not exists provider text default 'fal';

alter table public.generations
  add column if not exists provider_model text;

comment on column public.generations.provider is
  'Which image provider produced this row: fal or openai. Defaults to fal. '
  'Existing rows are left NULL rather than backfilled -- NULL means "made '
  'before the column existed", which is true and is different from "made by '
  'fal", even though both were in fact fal.';

comment on column public.generations.provider_model is
  'The provider-specific model identity. For fal that is the LoRA model_path; '
  'for openai it is the model id, e.g. gpt-image-2.5-flare.';

-- Expect: the two columns listed, both nullable, provider defaulting to 'fal'.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'generations'
  and column_name in ('provider', 'provider_model')
order by column_name;

-- Expect total_rows unchanged and every existing row NULL on both columns.
select count(*)                                          as total_rows,
       count(*) filter (where provider is null)          as provider_null,
       count(*) filter (where provider_model is null)    as provider_model_null
from public.generations;

commit;


-- ===========================================================================
-- Once the OpenAI lane has run, this is the per-lane comparison.
-- ===========================================================================
-- select provider, provider_model, status, count(*)
-- from public.generations
-- where provider is not null
-- group by provider, provider_model, status
-- order by provider, provider_model, status;


-- ===========================================================================
-- Reversal. Safe: nothing reads these columns unless the flag is on.
-- ===========================================================================
-- alter table public.generations drop column if exists provider;
-- alter table public.generations drop column if exists provider_model;
