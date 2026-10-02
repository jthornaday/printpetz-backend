-- Durable intake for paid Shopify orders (launch checklist A2, part 2).
--
-- The webhook records each paid order here BEFORE answering Shopify, then works on it. A server
-- restart mid-order (a merge to main) used to lose it silently; now a sweep finds anything left
-- in 'received' or stuck in 'processing' and retries it. Run BEFORE merging the code that uses it.

begin;

create table if not exists public.merch_orders (
  shopify_order_id text primary key,
  order_name text,
  status text not null default 'received'
    check (status in ('received', 'processing', 'fulfilled', 'failed', 'unfulfillable')),
  request jsonb,                -- the FulfillmentRequest, so any attempt can rebuild the order
  attempts integer not null default 0,
  printful_order_id bigint,
  last_error text,
  test boolean not null default false,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists merch_orders_open on public.merch_orders (status, updated_at)
  where status in ('received', 'processing');

alter table public.merch_orders enable row level security;
revoke all on public.merch_orders from anon, authenticated;

-- Hand out up to p_limit orders that need work, each to exactly one caller: 'received' ones that
-- have waited p_received_after, and 'processing' ones idle for p_stuck_after (their server died).
create or replace function public.claim_merch_orders(p_limit integer, p_received_after interval, p_stuck_after interval)
returns setof public.merch_orders
language sql security definer set search_path = public as $$
  update merch_orders m
     set status = 'processing', attempts = m.attempts + 1, updated_at = now()
   where m.shopify_order_id in (
     select shopify_order_id from merch_orders
      where (status = 'received' and updated_at < now() - p_received_after)
         or (status = 'processing' and updated_at < now() - p_stuck_after)
      order by received_at
      limit p_limit
      for update skip locked)
  returning m.*;
$$;

revoke all on function public.claim_merch_orders(integer, interval, interval) from public, anon, authenticated;
grant execute on function public.claim_merch_orders(integer, interval, interval) to service_role;

commit;
