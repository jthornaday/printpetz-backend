-- PrintPetz — revert Founding Father to its pre-wig base_prompt
-- Generated 2026-09-13. NOT run by Claude. Review, then apply in Supabase.
--
-- Why: update-founding-father.sql moved the wig to the first garment and
-- described it in detail (colour, rolled side curls, black ribbon, ears
-- showing). On Max test 6 that made the theme WORSE, not better -- more
-- 18th-century-portrait words pulled harder toward an 18th-century portrait,
-- and the theme rendered a human or a dog-headed human.
--
-- That is the "on hard themes, words are not the lever" finding. The wig was
-- never the problem; FLUX's human prior was, and adding costume detail feeds it.
--
-- This restores the text as inserted by insert-styles-themes.sql, with the
-- leading "Cute " already stripped so it matches what update-styles-global-
-- polish.sql did to every other row. Extracted from git rather than retyped.
--
-- Run this BEFORE the PRINTPETZ_LORA_SCALE A/B. Otherwise arm A is not a
-- control: it would measure the LoRA scale AND a prompt change already known
-- to hurt, and the two could not be told apart.
--
-- 67 words | worst assembled, longest variant: Natural 343 / Mascot 347 /
-- Cartoon 350 -- ceiling 400.
--
-- Safe to re-run.

begin;

-- Expect 1 row, currently showing the strengthened wig wording.
select id, name, length(base_prompt) as chars,
       base_prompt like '%rolled side curls%' as has_strengthened_wig
from public.styles
where name = 'Founding Father';

update public.styles
set base_prompt = '[TRIGGER_WORD] as a founding father, upright in a panelled hall. Wearing a plain deep blue colonial coat, a plain embroidered waistcoat, a plain cloth sash across the chest, plain breeches with tall stockings covering both legs, and buckled shoes. A powdered wig sits above the face, fully visible. The tricorn hat is off, resting on the desk beside them. Panelled hall background, dramatic lighting, ultra detailed 8K.'
where name = 'Founding Father';

-- Expect 1 row, has_strengthened_wig now false, and the prompt starting with
-- "[TRIGGER_WORD] as a founding father" (no leading "Cute ").
select id, name, length(base_prompt) as chars,
       base_prompt like '%rolled side curls%' as has_strengthened_wig,
       base_prompt like 'Cute %'              as has_cute_prefix,
       jsonb_array_length(variants) as variant_count
from public.styles
where name = 'Founding Father';

commit;
