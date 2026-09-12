alter table public.models
add column if not exists pet_description text;

comment on column public.models.pet_description is
'Optional owner-written description of the pet''s appearance (coat colour, breed, markings), injected into the generation prompt identity block. The trained LoRA alone does not reliably carry dark coat colours.';
