-- Lock credits so the browser can't change them (launch checklist A5, found 2026-10-01).
--
-- Before: one policy, "Enable users to view their own data only", but FOR ALL. Any signed-in user
-- could UPDATE (or DELETE) their own users row with the public key, including `credits`.
-- After: users can read their own row and change only name, email and profile_image (the profile
-- drawer's fields). Credits change only on the server (service role) and in the auth trigger
-- (SECURITY DEFINER), neither of which these grants or policies affect.

begin;

drop policy if exists "Enable users to view their own data only" on public.users;

create policy "Users read their own row" on public.users
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users update their own profile" on public.users
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke insert, update, delete on public.users from anon, authenticated;
grant update (name, email, profile_image) on public.users to authenticated;

commit;

-- Rollback (restores the old behaviour exactly, including the hole):
--   begin;
--   drop policy "Users read their own row" on public.users;
--   drop policy "Users update their own profile" on public.users;
--   grant insert, update, delete on public.users to anon, authenticated;
--   create policy "Enable users to view their own data only" on public.users
--     for all using ((select auth.uid()) = id);
--   commit;
