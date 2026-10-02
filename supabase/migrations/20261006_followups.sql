-- Post-delivery check-in email (specs/merch-reviews-followup.md §6.3). Run BEFORE merging the code.
--
-- - checkin_sent_at: when the "How did it turn out?" email was claimed for sending (set before the
--   send, so several servers can't both send it; a lost email beats a duplicate).
-- - checkin_skipped: true when the order was too old to check in on (so it isn't looked at again).
-- - email_suppressions: customers who replied "stop". Server-only.

begin;

alter table public.merch_orders
  add column if not exists checkin_sent_at timestamptz,
  add column if not exists checkin_skipped boolean not null default false;

create index if not exists merch_orders_checkin_due on public.merch_orders (shipped_at)
  where checkin_sent_at is null and status = 'fulfilled';

create table if not exists public.email_suppressions (
  email text primary key,          -- stored lower-case
  source text,
  created_at timestamptz not null default now()
);
alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from anon, authenticated;

commit;
