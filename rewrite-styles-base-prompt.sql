-- PrintPetz — rewrite styles.base_prompt to the baseball-standard template
-- Generated 2026-09-13. NOT run by Claude. Review, then paste into Supabase.
--
-- Covers all 23 non-baseball themes. Baseball (id 2) is deliberately excluded:
-- its subject is built in code (generation_controller.getGenerationSubject),
-- so its DB row is never read and editing it would be misleading.
--
-- Each base_prompt: 50-80 words, affirmative only, no identity/style/pose rules
-- (the code adds those). Every assembled prompt lands under 400 est. tokens in
-- all three styles; the highest is Cricket/Cartoon at 349.
--
-- REQUIRES the matching code change on branch fix/insignia-wording: 11 themes
-- below name a surface (sash, hat band, banner, guitar strap, ...) that only
-- exists once NAME_PLACEMENTS knows about it. Applying this SQL against the
-- current production code would put the name on a surface the prompt never
-- mentions. Deploy the code first.

begin;

-- id 1  Football
-- 76 words | assembled est. tokens — Natural 341 / Mascot 345 / Cartoon 348
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a football player, upright on the field. Wearing a plain white mesh jersey over plain padded shoulder pads, white fabric trousers covering both legs to the ankle, a belt at the waist, and cleated boots. Fur shows only on the head, forepaws and tail. The helmet is off, resting on the grass beside them, face fully visible. Exactly one football is cradled against the chest. Epic stadium background, dramatic lighting, ultra detailed 8K.'
where id = 1;

-- id 3  Basketball
-- 57 words | assembled est. tokens — Natural 316 / Mascot 320 / Cartoon 322
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a basketball player, upright on the court. Wearing a plain sleeveless mesh jersey, plain loose shorts to the knee, tall plain socks, and high-top sneakers. Fur shows on the head, forepaws, lower legs and tail. Exactly one basketball is held against one forepaw at hip height. Epic arena background, dramatic lighting, ultra detailed 8K.'
where id = 3;

-- id 4  Soccer
-- 56 words | assembled est. tokens — Natural 313 / Mascot 317 / Cartoon 320
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a soccer player, upright on the pitch. Wearing a plain short-sleeved jersey, plain fabric shorts, tall plain socks covering both lower legs, and studded boots. Fur shows only on the head, forepaws and tail. Exactly one soccer ball rests on the grass at their feet. Epic stadium background, dramatic lighting, ultra detailed 8K.'
where id = 4;

-- id 5  Hockey
-- 68 words | assembled est. tokens — Natural 332 / Mascot 336 / Cartoon 339
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a hockey player, upright on the ice. Wearing a plain jersey over padded shoulders, plain padded trousers covering both legs, tall socks, and skates. Fur shows only on the head, forepaws and tail. The helmet is off, resting on the boards beside them, face fully visible. Both forepaws grip exactly one hockey stick by the shaft. Epic ice rink background, dramatic lighting, ultra detailed 8K.'
where id = 5;

-- id 6  Skateboard
-- 72 words | assembled est. tokens — Natural 334 / Mascot 338 / Cartoon 341
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a skateboarder, upright in a skatepark. Wearing a plain skate tee, a plain open flannel shirt over it, plain denim trousers covering both legs to the ankle, and canvas skate shoes. Fur shows only on the head, forepaws and tail. The helmet is off, resting on the ledge beside them, face fully visible. Exactly one skateboard sits under both hind paws. Urban skatepark background, dramatic lighting, ultra detailed 8K.'
where id = 6;

-- id 7  Boxing
-- 63 words | assembled est. tokens — Natural 318 / Mascot 322 / Cartoon 324
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a boxer, upright in the ring. Wearing plain satin boxing trunks with a wide plain waistband, a plain cloth wrap at each wrist, and laced boxing boots. Fur shows on the head, forepaws, lower legs and tail. Exactly two boxing gloves, one fitted over each forepaw, raised in a steady guard. Epic boxing ring background, dramatic lighting, ultra detailed 8K.'
where id = 7;

-- id 8  Cricket
-- 74 words | assembled est. tokens — Natural 342 / Mascot 346 / Cartoon 349
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a cricket player, upright at the crease. Wearing a plain white cricket jersey, plain white trousers covering both legs to the ankle, plain pads over both shins, and white boots. Fur shows only on the head, forepaws and tail. The helmet is off, resting on the grass beside them, face fully visible. Both forepaws grip exactly one cricket bat by the handle. Professional cricket ground background, dramatic lighting, ultra detailed 8K.'
where id = 8;

-- id 9  Doctor
-- 75 words | assembled est. tokens — Natural 332 / Mascot 336 / Cartoon 339
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a doctor, upright on duty. Wearing a crisp white cotton coat over a plain pale blue scrub top, plain navy scrub trousers covering both legs to the ankle, and clean white clinical shoes. Fur shows only on the head, forepaws and tail. Exactly one stethoscope hangs around the neck, chestpiece resting on the coat. A plain fabric name patch sits on the left chest. Clean hospital background, dramatic lighting, ultra detailed 8K.'
where id = 9;

-- id 10  Police Officer
-- 66 words | assembled est. tokens — Natural 323 / Mascot 327 / Cartoon 329
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a police officer, upright on duty. Wearing a plain navy uniform shirt, a plain fabric name patch on the left chest, a plain utility belt, plain navy trousers covering both legs to the ankle, and polished black boots. Fur shows only on the head, forepaws and tail. Exactly one flashlight is clipped to the belt. Clean civic background, dramatic lighting, ultra detailed 8K.'
where id = 10;

-- id 11  Firefighter
-- 67 words | assembled est. tokens — Natural 326 / Mascot 330 / Cartoon 332
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a firefighter, upright at the station. Wearing a plain turnout coat with reflective bands, plain turnout trousers covering both legs to the ankle, and tall rubber boots. Fur shows only on the head, forepaws and tail. The helmet is off, held under one forepaw, face fully visible. A plain fabric name patch sits on the left chest. Firehouse background, dramatic lighting, ultra detailed 8K.'
where id = 11;

-- id 12  Soldier
-- 63 words | assembled est. tokens — Natural 302 / Mascot 306 / Cartoon 309
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a soldier, upright at attention. Wearing a plain olive field jacket, a plain name tape above the chest pocket, plain olive trousers covering both legs to the ankle, and laced field boots. Fur shows only on the head, forepaws and tail. The helmet is off, held under one forepaw, face fully visible. Cinematic outdoor background, dramatic lighting, ultra detailed 8K.'
where id = 12;

-- id 13  Astronaut
-- 67 words | assembled est. tokens — Natural 322 / Mascot 326 / Cartoon 329
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as an astronaut, upright aboard a spacecraft. Wearing a plain white space suit covering the torso and both legs to the boot, plain suit gloves over both forepaws, and a plain fabric name patch on the chest. Fur shows only on the head and tail. The helmet is off, held under one forepaw, face fully visible. Spacecraft interior background, dramatic sci-fi lighting, ultra detailed 8K.'
where id = 13;

-- id 14  Chef
-- 67 words | assembled est. tokens — Natural 316 / Mascot 320 / Cartoon 323
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a chef, upright at the pass. Wearing a plain white double-breasted chef coat, a plain apron tied at the waist, plain checked trousers covering both legs to the ankle, and a tall plain chef hat set back from the eyes. Fur shows only on the head, forepaws and tail. Both forepaws hold exactly one copper pan. Professional kitchen background, warm lighting, ultra detailed 8K.'
where id = 14;

-- id 15  Scientist
-- 69 words | assembled est. tokens — Natural 308 / Mascot 312 / Cartoon 314
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a scientist, upright at the bench. Wearing a plain white lab coat over a plain collared shirt, plain dark trousers covering both legs to the ankle, and clean closed shoes. Fur shows only on the head, forepaws and tail. The safety goggles are pushed up on the forehead, face fully visible. Both forepaws hold exactly one glass flask. Clean laboratory background, dramatic lighting, ultra detailed 8K.'
where id = 15;

-- id 16  Artist
-- 60 words | assembled est. tokens — Natural 300 / Mascot 304 / Cartoon 307
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as an artist, upright at the easel. Wearing a plain canvas apron over a plain long-sleeved shirt, plain denim trousers covering both legs to the ankle, and worn canvas shoes. Fur shows only on the head, forepaws and tail. Both forepaws hold exactly one paintbrush above a wooden palette. Colorful art studio background, dramatic lighting, ultra detailed 8K.'
where id = 16;

-- id 17  Pilot
-- 74 words | assembled est. tokens — Natural 314 / Mascot 318 / Cartoon 320
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a pilot, upright in the cockpit doorway. Wearing a plain navy pilot jacket, a plain white shirt with a dark tie, plain navy trousers covering both legs to the ankle, and polished black shoes. Fur shows only on the head, forepaws and tail. The peaked cap sits back from the eyes, face fully visible. A plain fabric name patch sits on the left chest. Aviation background, dramatic lighting, ultra detailed 8K.'
where id = 17;

-- id 18  Superhero
-- 66 words | assembled est. tokens — Natural 303 / Mascot 307 / Cartoon 310
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a superhero, upright and powerful. Wearing an original fitted suit with a plain chest panel, a plain flowing cape at the shoulders, a plain wide belt, and tall boots covering both legs to the knee. Fur shows only on the head, forepaws and tail. The cowl is pushed back off the face, face fully visible. Epic city background, dramatic lighting, ultra detailed 8K.'
where id = 18;

-- id 19  King
-- 73 words | assembled est. tokens — Natural 310 / Mascot 314 / Cartoon 317
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a king, upright in the throne room. Wearing a deep red velvet robe with plain ermine trim, a plain gold chest sash, a plain embroidered tunic, soft leather boots covering both legs to the knee, and a plain gold crown set back from the eyes. Fur shows only on the head, forepaws and tail. Both forepaws grip exactly one golden scepter. Palace throne room background, dramatic lighting, ultra detailed 8K.'
where id = 19;

-- id 20  Queen
-- 64 words | assembled est. tokens — Natural 296 / Mascot 300 / Cartoon 302
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a queen, upright in the throne room. Wearing an elegant deep blue velvet gown to the floor, a plain gold chest sash, a plain jeweled collar, and a plain gold crown set back from the eyes. Fur shows only on the head, forepaws and tail. Both forepaws hold exactly one golden orb. Palace throne room background, dramatic lighting, ultra detailed 8K.'
where id = 20;

-- id 21  Cowboy
-- 69 words | assembled est. tokens — Natural 311 / Mascot 315 / Cartoon 317
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a cowboy, upright in open country. Wearing a plain denim shirt, a plain leather vest, a plain leather belt, plain denim trousers covering both legs to the ankle, and worn leather boots. Fur shows only on the head, forepaws and tail. The wide-brimmed hat is tipped back with a plain hat band around the crown, face fully visible. Western landscape background, dramatic lighting, ultra detailed 8K.'
where id = 21;

-- id 22  Warrier
-- 80 words | assembled est. tokens — Natural 327 / Mascot 331 / Cartoon 334
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a heroic fantasy warrior. Wearing original steel shoulder plates over a plain deep red cloth tunic, leather bracers on both forearms, and dark cloth trousers covering both legs to the ankle. Fur shows only on the head, forepaws and tail. The helmet is off, resting beside them, face fully visible. Both forepaws grip exactly one upright sword by the handle. A plain cloth banner hangs on the wall behind. Castle courtyard background, dramatic lighting, ultra detailed 8K.'
where id = 22;

-- id 23  Pirate
-- 72 words | assembled est. tokens — Natural 308 / Mascot 312 / Cartoon 315
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a pirate, upright on the deck. Wearing a plain linen shirt, a long plain coat with wide cuffs, a plain waist sash, plain trousers covering both legs to the ankle, and tall leather boots. Fur shows only on the head, forepaws and tail. The tricorn hat is tipped back, face fully visible. Both forepaws grip exactly one wooden ship wheel. Ship and island background, dramatic lighting, ultra detailed 8K.'
where id = 23;

-- id 24  Rockstar
-- 59 words | assembled est. tokens — Natural 293 / Mascot 297 / Cartoon 300
update public.styles
set base_prompt = 'Cute [TRIGGER_WORD] as a rockstar, upright on stage. Wearing a plain black tee, a plain studded leather jacket, plain dark trousers covering both legs to the ankle, and buckled boots. Fur shows only on the head, forepaws and tail. Both forepaws hold exactly one electric guitar on a plain wide strap. Concert stage background, concert lighting, ultra detailed 8K.'
where id = 24;

-- Sanity check before committing: expect 23 rows, none over 600 characters,
-- and every row still carrying the [TRIGGER_WORD] placeholder.
select id, name, length(base_prompt) as chars,
       position('[TRIGGER_WORD]' in base_prompt) > 0 as has_trigger
from public.styles
where id in (1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24)
order by id;

commit;
