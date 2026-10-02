-- Tracking emails and cancellations for paid orders (launch checklist B1 + B2).
-- Run BEFORE merging the code that uses it.
--
-- - status gains 'cancelled' (the sweep never claims it; a fulfilment in flight checks it).
-- - shipments_emailed: Printful shipment ids we've already emailed the customer about (one email
--   per package, ever).
-- - shipped_at: first shipment date, for delivery estimates and the review follow-up.
-- - cancelled_at: when Shopify told us the order was cancelled.

begin;

alter table public.merch_orders drop constraint if exists merch_orders_status_check;
alter table public.merch_orders add constraint merch_orders_status_check
  check (status in ('received', 'processing', 'fulfilled', 'failed', 'unfulfillable', 'cancelled'));

alter table public.merch_orders
  add column if not exists shipments_emailed jsonb not null default '[]'::jsonb,
  add column if not exists shipped_at timestamptz,
  add column if not exists cancelled_at timestamptz;

create index if not exists merch_orders_awaiting_shipment on public.merch_orders (updated_at)
  where status = 'fulfilled' and shipped_at is null;

commit;
