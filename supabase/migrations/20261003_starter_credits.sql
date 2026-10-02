-- 40 free starter credits for every NEW account (last step of specs/free-credits-watermark.md).
-- Run only after the watermark code (#68–#71) and the frontend (#50) are live.
--
-- Same function as before, one change: when a customer row is created for the first time (email
-- just verified, or a Google sign-in), it starts with 40 free credits and a matching 'signup'
-- ledger row. An existing row is never granted again. Existing accounts are not affected.

create or replace function public.handle_new_and_update_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  created boolean;
begin
    if TG_OP = 'UPDATE' then
        -- When user just verified their email
        if old.email_confirmed_at is null and new.email_confirmed_at is not null then
            insert into public.users (id, email, free_credits)
            values (new.id, new.email, 40)
            on conflict (id) do update
            set email = excluded.email
            returning (xmax = 0) into created;   -- true only when the row was newly inserted
            if created then
                insert into public.credit_ledger (user_id, kind, ref, free_delta)
                values (new.id, 'signup', new.id::text, 40)
                on conflict (kind, ref) do nothing;
            end if;
        else
            -- Regular update if user already exists
            update public.users
            set email = new.email
            where id = new.id;
        end if;
    elsif TG_OP = 'DELETE' then
        delete from public.users where id = old.id;
    end if;

    return new;
end;
$function$;

-- Rollback: re-run the same function without `free_credits, 40` / the `created` block, i.e. the
-- definition captured on 2026-10-01 (insert into public.users (id, email) values (new.id, new.email)
-- on conflict (id) do update set email = excluded.email).
