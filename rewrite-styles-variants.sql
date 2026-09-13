-- PrintPetz — add variants to the 23 existing non-baseball themes
-- Generated 2026-09-13. NOT run by Claude. Review, then apply in Supabase.
--
-- Prerequisites: migrate-styles-category-variants.sql, and
-- rewrite-styles-base-prompt.sql (these variants are written against the
-- rewritten base_prompts, not the originals).
--
-- Baseball (id 2) is excluded: its subject is built in code and
-- getGenerationSubject returns before the variant is ever read.

begin;

-- id 1  Football — worst assembled: Natural 362 / Mascot 366 / Cartoon 369
update public.styles
set variants = '["mid-stride with the football tucked, low three-quarter camera, floodlights flaring","football raised in celebration, wide full-body framing, crowd far behind","close portrait from the chest up, floodlit, turf soft behind","turning upfield, side profile camera, yard lines receding behind","facing the camera at midfield, goal posts small behind"]'::jsonb
where id = 1;

-- id 3  Basketball — worst assembled: Natural 334 / Mascot 338 / Cartoon 340
update public.styles
set variants = '["rising for the shot, low three-quarter camera, hoop sharp above","basketball held at the hip, front-on camera, arena lights behind","close portrait from the chest up, warm arena glow, court soft behind","wide full-body framing at the arc, seating rising beyond","turning toward the camera, three-quarter framing, court lines receding"]'::jsonb
where id = 3;

-- id 4  Soccer — worst assembled: Natural 332 / Mascot 336 / Cartoon 339
update public.styles
set variants = '["mid-stride with the ball at the feet, side profile camera, pitch receding","arms raised in celebration, low heroic camera, floodlights flaring above","close portrait from the chest up, floodlit, pitch soft behind","wide full-body framing at the centre circle, goal small beyond","turning toward the camera, three-quarter framing, crowd blurred behind"]'::jsonb
where id = 4;

-- id 5  Hockey — worst assembled: Natural 352 / Mascot 356 / Cartoon 359
update public.styles
set variants = '["driving forward with the stick low, three-quarter camera, boards blurred behind","stick raised in celebration, wide full-body framing, rink lights above","close portrait from the chest up, cool light, ice soft behind","turning on the ice, side profile camera, spray lifting behind","facing the camera at the blue line, goal small behind"]'::jsonb
where id = 5;

-- id 6  Skateboard — worst assembled: Natural 353 / Mascot 357 / Cartoon 359
update public.styles
set variants = '["rolling along the ledge, low three-quarter camera, ramps receding behind","board tipped up underfoot, wide full-body framing, park stretching beyond","close portrait from the chest up, hard sun, concrete soft behind","turning toward the camera, three-quarter framing, painted walls behind","mid-push across the flat, side profile camera, long shadows ahead"]'::jsonb
where id = 6;

-- id 7  Boxing — worst assembled: Natural 336 / Mascot 340 / Cartoon 343
update public.styles
set variants = '["guard raised at the ready, low three-quarter camera, ring blurred behind","arms raised in celebration, wide full-body framing, ring lights above","close portrait from the chest up, hard light, ring soft behind","mid-punch with the arm extended, side profile camera, canvas below","turning toward the camera, three-quarter framing, arena dark beyond"]'::jsonb
where id = 7;

-- id 8  Cricket — worst assembled: Natural 363 / Mascot 367 / Cartoon 369
update public.styles
set variants = '["mid-swing through the shot, low three-quarter camera, floodlights glaring behind","guarding the crease awaiting delivery, front-on camera, stumps sharp behind","bat raised in celebration, wide full-body framing, packed pavilion beyond","close portrait from the chest up, scoreboard glowing out of focus behind","walking out to the middle, side profile camera, long outfield shadows"]'::jsonb
where id = 8;

-- id 9  Doctor — worst assembled: Natural 350 / Mascot 354 / Cartoon 357
update public.styles
set variants = '["reviewing a chart, three-quarter camera, corridor receding behind","close portrait from the chest up, clean light, ward soft behind","wide full-body framing in the corridor, doorways beyond","turning toward the camera, low angle, ceiling lights receding","mid-stride along the ward, side profile camera, windows bright behind"]'::jsonb
where id = 9;

-- id 10  Police Officer — worst assembled: Natural 341 / Mascot 345 / Cartoon 347
update public.styles
set variants = '["on patrol along the street, side profile camera, storefronts receding","close portrait from the chest up, daylight, civic building soft behind","wide full-body framing on the steps, plaza stretching beyond","turning toward the camera, three-quarter framing, patrol lights behind","raising one arm to direct, low angle, traffic blurred behind"]'::jsonb
where id = 10;

-- id 11  Firefighter — worst assembled: Natural 344 / Mascot 348 / Cartoon 351
update public.styles
set variants = '["turning at the bay doorway, three-quarter camera, engine gleaming behind","close portrait from the chest up, warm light, station soft behind","wide full-body framing in the bay, engine gleaming beyond","turning toward the camera, low angle, station doors open behind","mid-stride across the forecourt, side profile camera, long shadows ahead"]'::jsonb
where id = 11;

-- id 12  Soldier — worst assembled: Natural 321 / Mascot 325 / Cartoon 328
update public.styles
set variants = '["at ease on the parade square, wide full-body framing, flag poles beyond","close portrait from the chest up, overcast light, field soft behind","turning toward the camera, three-quarter framing, vehicles blurred behind","mid-stride across the ground, side profile camera, long shadows ahead","saluting with one arm raised, low heroic camera, sky wide behind"]'::jsonb
where id = 12;

-- id 13  Astronaut — worst assembled: Natural 341 / Mascot 345 / Cartoon 347
update public.styles
set variants = '["mid-stride along the module, three-quarter camera, hatch glowing behind","close portrait from the chest up, cool light, instrument panels behind","wide full-body framing in the module, cupola window beyond","turning toward the camera, low angle, corridor lights receding","raising one arm in greeting, three-quarter framing, earth visible beyond"]'::jsonb
where id = 13;

-- id 14  Chef — worst assembled: Natural 335 / Mascot 339 / Cartoon 342
update public.styles
set variants = '["lifting the pan from the flame, three-quarter camera, kitchen steam rising","close portrait from the chest up, warm light, pass soft behind","wide full-body framing at the pass, plated dishes beyond","turning toward the camera, low angle, hanging pans above","mid-stride along the line, side profile camera, burners glowing behind"]'::jsonb
where id = 14;

-- id 15  Scientist — worst assembled: Natural 326 / Mascot 330 / Cartoon 332
update public.styles
set variants = '["raising the flask to the light, three-quarter camera, bench soft behind","close portrait from the chest up, cool light, glassware blurred behind","wide full-body framing at the bench, laboratory receding beyond","turning toward the camera, low angle, ceiling lights receding","mid-stride along the bench, side profile camera, equipment glowing"]'::jsonb
where id = 15;

-- id 16  Artist — worst assembled: Natural 319 / Mascot 323 / Cartoon 325
update public.styles
set variants = '["brush raised toward the easel, three-quarter camera, studio light warm","close portrait from the chest up, window light, easel soft behind","wide full-body framing beside the easel, studio stretching beyond","turning toward the camera, low angle, paint jars cluttered behind","mid-stride across the studio, side profile camera, frames stacked behind"]'::jsonb
where id = 16;

-- id 17  Pilot — worst assembled: Natural 332 / Mascot 336 / Cartoon 338
update public.styles
set variants = '["walking the tarmac, side profile camera, airliner rising behind","close portrait from the chest up, window light, cockpit soft behind","wide full-body framing in the doorway, jet bridge beyond","turning toward the camera, three-quarter framing, runway lights behind","raising one arm in greeting, low angle, terminal glass behind"]'::jsonb
where id = 17;

-- id 18  Superhero — worst assembled: Natural 321 / Mascot 325 / Cartoon 327
update public.styles
set variants = '["arms lowered after landing, low heroic camera, dust settling around","close portrait from the chest up, dawn light, towers soft behind","wide full-body framing on the plaza, skyline stretching beyond","turning toward the camera, three-quarter framing, clouds racing above","mid-stride down the avenue, side profile camera, sun low behind"]'::jsonb
where id = 18;

-- id 19  King — worst assembled: Natural 330 / Mascot 334 / Cartoon 336
update public.styles
set variants = '["raising the scepter in address, low heroic camera, throne looming behind","turning to face the hall, three-quarter camera, stained glass glowing beyond","close portrait from the chest up, candlelit, tapestries soft behind","wide full-body framing on the dais steps, torches lining the hall","surveying the court, side profile camera, throne room receding behind"]'::jsonb
where id = 19;

-- id 20  Queen — worst assembled: Natural 315 / Mascot 319 / Cartoon 321
update public.styles
set variants = '["holding the orb at the waist, three-quarter camera, throne behind","close portrait from the chest up, candlelight warm, tapestries behind","wide full-body framing on the dais, hall receding beyond","turning toward the camera, low angle, stained glass glowing behind","mid-stride across the floor, side profile camera, torches lining the hall"]'::jsonb
where id = 20;

-- id 21  Cowboy — worst assembled: Natural 329 / Mascot 333 / Cartoon 335
update public.styles
set variants = '["squinting toward the horizon, side profile camera, mesa rising behind","close portrait from the chest up, low sun, dust hazing behind","wide full-body framing on the ridge, canyon stretching beyond","turning toward the camera, three-quarter framing, scrub and sky behind","mid-stride across the dirt, low angle, long shadows ahead"]'::jsonb
where id = 21;

-- id 22  Warrier — worst assembled: Natural 345 / Mascot 349 / Cartoon 352
update public.styles
set variants = '["raising the sword overhead, low heroic camera, courtyard walls behind","close portrait from the chest up, torchlight warm, stone soft behind","wide full-body framing in the courtyard, keep rising beyond","turning toward the camera, three-quarter framing, mountains far behind","mid-stride across the flagstones, side profile camera, long shadows"]'::jsonb
where id = 22;

-- id 23  Pirate — worst assembled: Natural 326 / Mascot 330 / Cartoon 333
update public.styles
set variants = '["hauling the wheel around, low three-quarter camera, rigging above","close portrait from the chest up, sea light, sails soft behind","wide full-body framing on the deck, island beyond","turning toward the camera, three-quarter framing, waves breaking behind","mid-stride along the deck, side profile camera, rigging strung above"]'::jsonb
where id = 23;

-- id 24  Rockstar — worst assembled: Natural 313 / Mascot 317 / Cartoon 320
update public.styles
set variants = '["mid-riff with the guitar high, low three-quarter camera, stage lights flaring","close portrait from the chest up, spotlight warm, haze soft behind","wide full-body framing at the edge, crowd silhouetted beyond","turning toward the camera, three-quarter framing, amps stacked behind","arm raised to the crowd, low angle, lights burning above"]'::jsonb
where id = 24;

-- Sanity check: expect 23 rows, each with 5 variants.
select id, name, jsonb_array_length(variants) as variant_count
from public.styles
where id in (1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24)
order by id;

commit;
