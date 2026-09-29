-- Delivery receipts prevent Telegram webhook retries from sending duplicate replies.
create table public.kve_bot_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

alter table public.kve_bot_updates enable row level security;
revoke all on public.kve_bot_updates from public, anon, authenticated;
grant select, insert, delete on public.kve_bot_updates to service_role;

create index kve_bot_updates_received_at on public.kve_bot_updates(received_at);
