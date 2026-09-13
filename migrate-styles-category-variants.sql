-- PrintPetz — migration: styles.category and styles.variants
-- Generated 2026-09-13. NOT run by Claude. Review, then apply in Supabase.
--
-- Run this AFTER extend-category-enum.sql and BEFORE insert-styles-themes.sql
-- and rewrite-styles-variants.sql.
--
-- Safe to re-run. Every statement is idempotent: add column if not exists,
-- create or replace function, and a guarded constraint. Re-running it after a
-- successful run is a no-op.

begin;

-- 1. category ------------------------------------------------------------
-- Nothing to do here. styles.category already exists and is an ENUM
-- (public."GENERATION_CATEGORY"), not text.
--
-- An earlier draft of this file carried `add column if not exists category
-- text`. That was a no-op against the real database, but it was a trap: run on
-- a fresh environment where the column was absent, it would have created a
-- TEXT column and every later enum-typed insert would have behaved differently
-- from production. Removed rather than corrected — the column is not this
-- file's to create.
--
-- Adding the expansion labels to the enum is a separate file,
-- extend-category-enum.sql, because ALTER TYPE ... ADD VALUE cannot live in
-- the begin/commit block below.
--
-- No CHECK constraint either: the enum already constrains the column, and a
-- CHECK listing the same labels would be a second place to forget to update.

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
