-- PrintPetz — point training_images at the converted sRGB photos
-- Generated 2026-09-15 by scripts/backfill-srgb-photos. NOT run by Claude.
-- Review, then apply in Supabase.
--
-- Every original S3 object is untouched. These updates only repoint the
-- rows at the converted copies, so the reversal at the bottom is complete.
--
-- Each model is all-or-nothing: a model only appears here if EVERY one of
-- its photos was converted, re-fetched from S3 and re-classified as
-- acceptable. One bad reference fails every theme, so a partial repair
-- would look fixed and still be broken.

begin;

-- Tom (model 15)
-- BEFORE (for the reversal at the bottom):
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104294679-IMG_0413.HEIC
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104294680-IMG_0173.HEIC
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104293631-IMG_2677.heic
update public.models set training_images = ARRAY[
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104294679-IMG_0413-srgb.jpg',
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104294680-IMG_0173-srgb.jpg',
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104293631-IMG_2677-srgb.jpg'
  ]::text[]
  where id = 15;

-- George (model 16)
-- BEFORE (for the reversal at the bottom):
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297808-IMG_4325.HEIC
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297810-IMG_4129.HEIC
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297578-IMG_8858.heic
update public.models set training_images = ARRAY[
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297808-IMG_4325-srgb.jpg',
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297810-IMG_4129-srgb.jpg',
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297578-IMG_8858-srgb.jpg'
  ]::text[]
  where id = 16;

-- Max (model 27)
-- BEFORE (for the reversal at the bottom):
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054087-9A067FDE-F320-4419-91B8-44BD0D72A42D_1_105_c.jpeg
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054087-8A6C5D5A-0DA6-4022-8306-EF623AE86D2B_1_105_c.jpeg
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054106-D8574D2B-22E8-4C4E-AA75-A1A07ADF382D_1_105_c.jpeg
--   https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054107-0F27F2F2-5CD8-4800-B29A-95245BD3A9FA_1_105_c.jpeg
update public.models set training_images = ARRAY[
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054087-9A067FDE-F320-4419-91B8-44BD0D72A42D_1_105_c-srgb.jpg',
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054087-8A6C5D5A-0DA6-4022-8306-EF623AE86D2B_1_105_c-srgb.jpg',
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054106-D8574D2B-22E8-4C4E-AA75-A1A07ADF382D_1_105_c-srgb.jpg',
    'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054107-0F27F2F2-5CD8-4800-B29A-95245BD3A9FA_1_105_c-srgb.jpg'
  ]::text[]
  where id = 27;

-- Expect one row per model above, each showing the -srgb.jpg URLs.
select id, name, pet_name, training_images from public.models where id in (15, 16, 27) order by id;

commit;


-- ===========================================================================
-- Reversal. The originals were never overwritten, so this fully restores the
-- previous state.
-- ===========================================================================
-- Tom (model 15)
-- update public.models set training_images = ARRAY[
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104294679-IMG_0413.HEIC',
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104294680-IMG_0173.HEIC',
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788104293631-IMG_2677.heic'
--   ]::text[]
--   where id = 15;
-- George (model 16)
-- update public.models set training_images = ARRAY[
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297808-IMG_4325.HEIC',
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297810-IMG_4129.HEIC',
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1788110297578-IMG_8858.heic'
--   ]::text[]
--   where id = 16;
-- Max (model 27)
-- update public.models set training_images = ARRAY[
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054087-9A067FDE-F320-4419-91B8-44BD0D72A42D_1_105_c.jpeg',
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054087-8A6C5D5A-0DA6-4022-8306-EF623AE86D2B_1_105_c.jpeg',
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054106-D8574D2B-22E8-4C4E-AA75-A1A07ADF382D_1_105_c.jpeg',
--     'https://d155jdfit5sgy.cloudfront.net/training-images/a36d9307-659c-458f-9e4b-0c0ae0ab12e9/1789333054107-0F27F2F2-5CD8-4800-B29A-95245BD3A9FA_1_105_c.jpeg'
--   ]::text[]
--   where id = 27;
