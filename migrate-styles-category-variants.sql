-- PrintPetz — migration: styles.category and styles.variants
-- Generated 2026-09-13. NOT run by Claude. Review, then apply in Supabase.
--
-- Run this BEFORE insert-styles-themes.sql and rewrite-styles-variants.sql.
--
-- Safe to re-run. Every statement is idempotent: add column if not exists,
-- create or replace function, and a guarded constraint. Re-running it after a
-- successful run is a no-op.

begin;

-- 1. category ------------------------------------------------------------
-- The column already exists (it is on IStyle and comes back via select *).
-- This is idempotent insurance only. No NOT NULL and no CHECK constraint is
-- added here: the current distinct values were never supplied, and a CHECK
-- written against a guess would reject rows that are already live.
alter table public.styles add column if not exists category text;

-- After reviewing `select category, count(*) from public.styles group by 1;`
-- the constraint below can be enabled. The six values are the ones this
-- expansion introduces or reuses.
-- do $do$
-- begin
--   if not exists (
--     select 1 from pg_constraint
--     where conname = 'styles_category_allowed'
--       and conrelid = 'public.styles'::regclass
--   ) then
--     alter table public.styles
--       add constraint styles_category_allowed check (category in (
--         'Sports', 'Professions', 'Themes', 'Christmas', 'Thanksgiving',
--         '4th of July', 'Historical', 'Heroes'
--       ));
--   end if;
-- end
-- $do$;

-- 2. variants ------------------------------------------------------------
alter table public.styles add column if not exists variants jsonb;

comment on column public.styles.variants is
  'Optional array of 3-5 strings, each <= 14 words: action, camera framing and '
  'a setting detail. Never posture (the POSE block owns that), never wardrobe, '
  'never the pet. Image i uses variants[(offset + i) % length]. Null disables '
  'variation and the theme behaves as it did before this column existed.';

-- A CHECK constraint cannot contain a subquery, so the shape test lives in an
-- immutable helper. This is the only thing stopping a paragraph or a stray
-- number from reaching a prompt.
create or replace function public.styles_variants_ok(v jsonb)
returns boolean
language sql
immutable
as $$
  select v is null
      or (
        jsonb_typeof(v) = 'array'
        and jsonb_array_length(v) between 3 and 5
        and (
          select bool_and(
            jsonb_typeof(e) = 'string'
            and btrim(e #>> '{}') <> ''
            and array_length(regexp_split_to_array(btrim(e #>> '{}'), '\s+'), 1) <= 14
          )
          from jsonb_array_elements(v) e
        )
      );
$$;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the guard is explicit. This
-- file has to survive being run twice: a failure further down should not mean
-- hand-editing it before the retry. A distinct dollar-quote tag ($do$) is used
-- because the function body above is already quoted with $$.
do $do$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'styles_variants_shape'
      and conrelid = 'public.styles'::regclass
  ) then
    alter table public.styles
      add constraint styles_variants_shape check (public.styles_variants_ok(variants));
  end if;
end
$do$;

commit;

-- Rollback
-- alter table public.styles drop constraint if exists styles_variants_shape;
-- drop function if exists public.styles_variants_ok(jsonb);
-- alter table public.styles drop column if exists variants;
