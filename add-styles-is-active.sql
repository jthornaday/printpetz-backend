-- PrintPetz — add styles.is_active so themes can be hidden from the picker
-- Generated 2026-09-13. NOT run by Claude. Review, then apply in Supabase.
--
-- The frontend reads styles straight from Supabase, not through the API:
--   src/store/api/styleApi.ts
--   supabase.from("styles").select("*").order("id")
-- so hiding a theme means a column it can filter on, plus one line there.
--
-- Why a flag and NOT deletion or a category change: generations.style_id
-- references these rows. Deleting or re-categorising a theme would break every
-- past order that used it. A flag hides the theme from new work and leaves
-- history intact.
--
-- The two steps are in SEPARATE transactions on purpose. Step 1 is safe to run
-- now and changes nothing visible. Step 2 is a product decision that the log
-- gates on the LoRA-scale A/B, so run it only once you have decided.

-- ===========================================================================
-- STEP 1 — add the column. No behaviour change: every existing row defaults to
-- true, and the frontend ignores a column it does not filter on until the
-- matching one-line change ships.
-- ===========================================================================
begin;

alter table public.styles
  add column if not exists is_active boolean not null default true;

comment on column public.styles.is_active is
  'False hides the theme from the picker. The frontend filters on this in '
  'styleApi.getStyles. Never delete or re-categorise a theme to hide it: '
  'generations.style_id references these rows.';

-- Expect: total_rows unchanged, active_rows equal to total_rows.
select count(*) as total_rows,
       count(*) filter (where is_active) as active_rows
from public.styles;

commit;


-- ===========================================================================
-- STEP 2 — hide the known-bad categories. Run only when you have decided to.
--
-- Historical (8) and Heroes (5) = 13 rows. Both are the strong-human-costume
-- group: FLUX has seen thousands of dogs in Santa suits and none dressed as
-- Thomas Jefferson, so its human prior beats the LoRA. Archery and Warrior fail
-- the same way but sit in Sports and Themes, so they are NOT covered here --
-- hide them individually if the A/B does not rescue them (statement below).
-- ===========================================================================
begin;

-- Expect 13.
select count(*) as rows_to_hide
from public.styles
where category in ('Historical', 'Heroes');

update public.styles
set is_active = false
where category in ('Historical', 'Heroes');

-- Expect: hidden_rows 13, and the names listed for a visual check.
select count(*) filter (where not is_active) as hidden_rows,
       count(*) filter (where is_active)     as visible_rows,
       count(*)                              as total_rows
from public.styles;

select id, name, category from public.styles where not is_active order by category, name;

commit;


-- ===========================================================================
-- Optional extras and reversals — all commented out.
-- ===========================================================================

-- Also hide the two individual themes that fail the same way:
-- update public.styles set is_active = false where name in ('Archery', 'Warrior');

-- Un-hide one theme once it is fixed:
-- update public.styles set is_active = true where name = 'Founding Father';

-- Un-hide everything (undo STEP 2 entirely):
-- update public.styles set is_active = true where not is_active;

-- Drop the column (undo STEP 1). Do this only after the frontend filter is
-- removed, or getStyles will error on a missing column.
-- alter table public.styles drop column if exists is_active;
