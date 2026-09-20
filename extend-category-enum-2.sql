-- extend-category-enum-2.sql
-- Two new categories: Fantasy, Intergalactic. Same mechanics as the Sept 13
-- migration (extend-category-enum.sql): autocommitted, not wrapped in a
-- transaction (Postgres disallows that for ALTER TYPE ... ADD VALUE),
-- idempotent via IF NOT EXISTS. Run this in the Supabase SQL editor yourself
-- BEFORE the style insert below -- the insert casts category to this enum
-- type and will fail on 'Fantasy'/'Intergalactic' until these values exist.

alter type "GENERATION_CATEGORY" add value if not exists 'Fantasy';
alter type "GENERATION_CATEGORY" add value if not exists 'Intergalactic';
