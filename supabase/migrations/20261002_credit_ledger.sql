-- Free starter credits, step 1 of specs/free-credits-watermark.md.
--
-- Two balances (free_credits spent before credits) and a server-only ledger. Every spend, refund
-- and purchase is one ledger row, unique per (kind, ref), so retries and redelivered webhooks can't
-- double-charge, double-refund or double-credit. A refund reverses the original row exactly (free
-- back to free, paid back to paid). The ledger also says which images used free credits, which
-- decides the watermark.
--
-- Safe to run before the code that uses it: nothing changes for anyone until the backend calls
-- these functions, and free_credits is 0 for everyone until the signup trigger grants it (last step).

begin;

alter table public.users
  add column if not exists free_credits integer not null default 0 check (free_credits >= 0);

create table if not exists public.credit_ledger (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,          -- 'training' | 'generation' | 'purchase' | 'refund:<kind>' | 'signup'
  ref text not null,           -- request id, generation id, Stripe session id, ...
  free_delta integer not null default 0,
  paid_delta integer not null default 0,
  created_at timestamptz not null default now(),
  unique (kind, ref)
);
create index if not exists credit_ledger_user on public.credit_ledger (user_id, created_at);

-- Watermark bookkeeping for images made with free credits (used from step 3 on).
create table if not exists public.generation_assets (
  generation_id bigint primary key references public.generations(id) on delete cascade,
  original_key text,           -- S3 key of the clean original; never sent to the browser
  unlocked_at timestamptz,     -- set when the customer's first purchase unlocks it
  created_at timestamptz not null default now()
);

-- Server only: RLS on, no policies, no grants for the browser roles.
alter table public.credit_ledger enable row level security;
alter table public.generation_assets enable row level security;
revoke all on public.credit_ledger, public.generation_assets from anon, authenticated;
revoke all on sequence public.credit_ledger_id_seq from anon, authenticated;

-- Spend `p_amount`, free credits first. Returns one row (free_spent, paid_spent), or no row if the
-- balance is short. Idempotent: spending the same (kind, ref) again returns the original split
-- without charging again.
create or replace function public.spend_credits(p_user uuid, p_amount integer, p_kind text, p_ref text)
returns table (free_spent integer, paid_spent integer)
language plpgsql security definer set search_path = public as $$
declare
  f integer; c integer; fs integer; ps integer;
begin
  if p_amount <= 0 then
    raise exception 'spend_credits: amount must be positive';
  end if;
  select -l.free_delta, -l.paid_delta into fs, ps
    from credit_ledger l where l.kind = p_kind and l.ref = p_ref;
  if found then
    return query select fs, ps;
    return;
  end if;
  select u.free_credits, u.credits into f, c from users u where u.id = p_user for update;
  if not found or f + c < p_amount then
    return;
  end if;
  fs := least(f, p_amount);
  ps := p_amount - fs;
  update users set free_credits = f - fs, credits = c - ps where id = p_user;
  insert into credit_ledger (user_id, kind, ref, free_delta, paid_delta)
    values (p_user, p_kind, p_ref, -fs, -ps);
  return query select fs, ps;
end $$;

-- Reverse a spend exactly. Returns true if credits were returned now, false if already refunded.
-- Charges made before this ledger existed have no row; they're returned as `p_fallback_paid` paid
-- credits so nobody loses a refund across the deploy.
create or replace function public.refund_charge(p_user uuid, p_kind text, p_ref text, p_fallback_paid integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  fs integer := 0; ps integer := p_fallback_paid;
begin
  select -l.free_delta, -l.paid_delta into fs, ps
    from credit_ledger l where l.kind = p_kind and l.ref = p_ref and l.user_id = p_user;
  if not found then
    fs := 0; ps := p_fallback_paid;
  end if;
  insert into credit_ledger (user_id, kind, ref, free_delta, paid_delta)
    values (p_user, 'refund:' || p_kind, p_ref, fs, ps)
    on conflict (kind, ref) do nothing;
  if not found then
    return false;
  end if;
  update users set free_credits = free_credits + fs, credits = credits + ps where id = p_user;
  return true;
end $$;

-- Add purchased (paid) credits once per Stripe checkout session. Returns (applied, first_purchase).
create or replace function public.add_paid_credits(p_user uuid, p_amount integer, p_ref text)
returns table (applied boolean, first_purchase boolean)
language plpgsql security definer set search_path = public as $$
declare
  earlier integer;
begin
  select count(*) into earlier from credit_ledger where user_id = p_user and kind = 'purchase';
  insert into credit_ledger (user_id, kind, ref, paid_delta)
    values (p_user, 'purchase', p_ref, p_amount)
    on conflict (kind, ref) do nothing;
  if not found then
    return query select false, false;
    return;
  end if;
  update users set credits = credits + p_amount where id = p_user;
  return query select true, earlier = 0;
end $$;

-- Only the server (service role) may call these. Supabase grants EXECUTE on new public functions to
-- the browser roles by default, which would let anyone call them over the REST API.
revoke all on function public.spend_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.refund_charge(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.add_paid_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.spend_credits(uuid, integer, text, text) to service_role;
grant execute on function public.refund_charge(uuid, text, text, integer) to service_role;
grant execute on function public.add_paid_credits(uuid, integer, text) to service_role;

commit;
