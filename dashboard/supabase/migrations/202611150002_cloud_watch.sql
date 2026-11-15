begin;
create table if not exists public.gg_watch_pairs (
  device_id uuid primary key,
  code_hash text unique,
  watch_hash text not null unique,
  browser_hash text,
  expires_at timestamptz not null,
  last_seen timestamptz,
  watch jsonb,
  observed_at double precision
);
create index if not exists gg_watch_browser_idx on public.gg_watch_pairs (browser_hash);
create index if not exists gg_watch_expiry_idx on public.gg_watch_pairs (expires_at);

create table if not exists public.gg_watch_events (
  device_id uuid not null references public.gg_watch_pairs(device_id) on delete cascade,
  event_id uuid not null,
  created_at timestamptz not null,
  event jsonb not null,
  version integer not null default 0,
  primary key (device_id, event_id)
);
create index if not exists gg_watch_event_recent_idx on public.gg_watch_events (device_id, created_at desc);

create table if not exists public.gg_pair_rate (
  bucket text primary key,
  expires_at timestamptz not null,
  attempts integer not null
);
alter table public.gg_watch_pairs enable row level security;
alter table public.gg_watch_events enable row level security;
alter table public.gg_pair_rate enable row level security;
revoke all on public.gg_watch_pairs, public.gg_watch_events, public.gg_pair_rate from public, anon, authenticated;
grant select, insert, update, delete on public.gg_watch_pairs, public.gg_watch_events, public.gg_pair_rate to service_role;

create or replace function public.gg_pairing_attempt(rate_key text, allowance integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_attempts integer;
begin
  delete from public.gg_pair_rate where expires_at <= now();
  delete from public.gg_watch_pairs where expires_at <= now();
  insert into public.gg_pair_rate(bucket, expires_at, attempts)
    values (rate_key, now() + interval '5 minutes', 1)
    on conflict (bucket) do update set attempts =
      case when public.gg_pair_rate.expires_at <= now() then 1 else least(public.gg_pair_rate.attempts + 1, 10000) end,
      expires_at = case when public.gg_pair_rate.expires_at <= now() then excluded.expires_at else public.gg_pair_rate.expires_at end
    returning attempts into current_attempts;
  return current_attempts <= allowance;
end;
$$;
revoke all on function public.gg_pairing_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.gg_pairing_attempt(text, integer) to service_role;
commit;
select tablename, rowsecurity from pg_tables where schemaname = 'public'
  and tablename in ('gg_watch_pairs','gg_watch_events','gg_pair_rate') order by 1;
