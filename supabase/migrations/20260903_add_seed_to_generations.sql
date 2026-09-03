alter table public.generations
add column if not exists seed bigint;

comment on column public.generations.seed is
'The seed sent to fal for this generation. Written at insert time rather than from the webhook, so a generation that fails or loses its webhook still has a reproducible seed on record.';
