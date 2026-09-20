-- seed-custom-style.sql
-- NOT run by Claude. Review, then apply in the Supabase SQL editor.
-- generations.style_id is NOT NULL (FK to styles.id), and a free-text custom
-- generation has no real theme, so every custom generation points at this one
-- row. getCustomStyle() finds it by name = 'Custom'.
-- is_active = false keeps it out of the picker; the row stays, so history
-- rows that reference it remain valid. Requires add-styles-is-active.sql STEP 1.
-- base_prompt is unused: custom prompts are built from the customer's description.
-- Re-runnable via `where not exists`.

insert into public.styles (name, category, image, base_prompt, is_active)
select 'Custom', 'Themes'::"GENERATION_CATEGORY", '', 'unused: custom generations build their prompt from the customer description', false
where not exists (select 1 from public.styles where name = 'Custom');

select id, name, category, is_active from public.styles where name = 'Custom';
