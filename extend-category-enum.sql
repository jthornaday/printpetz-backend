-- PrintPetz — add the expansion categories to the GENERATION_CATEGORY enum
-- Generated 2026-09-13. NOT run by Claude. Review, then apply in Supabase.
--
-- styles.category is an enum, not text. Before this file its labels are
-- Sports, Professions, Themes. insert-styles-themes.sql uses six categories;
-- Sports already exists, so five labels are added here.
--
-- NO begin/commit wrapper, deliberately. ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction block on older servers, and even where it is allowed the
-- new label cannot be USED until the adding transaction has committed. Running
-- these as five autocommitted statements means insert-styles-themes.sql can run
-- immediately afterwards. Do not wrap this file in a transaction.
--
-- The type name is quoted because it is genuinely upper-case: Postgres reported
-- it as "GENERATION_CATEGORY", and an unquoted identifier would fold to
-- generation_category and fail to resolve.
--
-- Each statement is idempotent via IF NOT EXISTS, so the file is safe to re-run.

-- ---------------------------------------------------------------------------
-- Run this first to confirm the type name, its schema, and the current labels.
-- If nspname is not "public", adjust the qualifier on the statements below.
-- ---------------------------------------------------------------------------
-- select n.nspname as schema, t.typname as type, e.enumlabel as label, e.enumsortorder
-- from pg_type t
--   join pg_namespace n on n.oid = t.typnamespace
--   join pg_enum e on e.enumtypid = t.oid
-- where t.typname ilike 'generation_category'
-- order by e.enumsortorder;

alter type public."GENERATION_CATEGORY" add value if not exists 'Christmas';

alter type public."GENERATION_CATEGORY" add value if not exists 'Thanksgiving';

alter type public."GENERATION_CATEGORY" add value if not exists '4th of July';

alter type public."GENERATION_CATEGORY" add value if not exists 'Historical';

alter type public."GENERATION_CATEGORY" add value if not exists 'Heroes';

-- ---------------------------------------------------------------------------
-- Verify: expect all six of Sports, Christmas, Thanksgiving, 4th of July,
-- Historical and Heroes to be present before running insert-styles-themes.sql.
-- ---------------------------------------------------------------------------
select e.enumlabel as label, e.enumsortorder
from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
where t.typname ilike 'generation_category'
order by e.enumsortorder;

-- There is no clean rollback. Postgres cannot drop a single enum label; undoing
-- this means recreating the type and rewriting every column that uses it.
