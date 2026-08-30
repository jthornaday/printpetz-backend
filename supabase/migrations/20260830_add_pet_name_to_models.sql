alter table public.models
add column if not exists pet_name text;

comment on column public.models.pet_name is
'The pet name used for artwork personalization. Model name remains an internal organization label.';
