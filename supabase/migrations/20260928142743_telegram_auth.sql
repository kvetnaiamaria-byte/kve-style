-- Only the server can read or bind Telegram identities. Existing libraries are untouched.
create table public.kve_telegram_accounts (
 telegram_id bigint primary key check (telegram_id > 0),
 user_id uuid not null unique,
 email text,
 provisioned boolean not null default false,
 created_at timestamptz not null default now(),
 last_attempt timestamptz
);
alter table public.kve_telegram_accounts enable row level security;
revoke all on public.kve_telegram_accounts from public, anon, authenticated;
grant select, insert, update on public.kve_telegram_accounts to service_role;
create table public.kve_telegram_proofs (
 fingerprint text primary key check(fingerprint ~ '^[0-9a-f]{64}$'),
 used_at timestamptz not null default now()
);
alter table public.kve_telegram_proofs enable row level security;
revoke all on public.kve_telegram_proofs from public, anon, authenticated;
grant select, insert, delete on public.kve_telegram_proofs to service_role;
create index kve_telegram_proofs_used_at on public.kve_telegram_proofs(used_at);
create function public.kve_telegram_claim(p_telegram_id bigint,p_fingerprint text,p_action text,p_link_user uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.kve_telegram_accounts; fresh_id uuid;
begin
 if p_telegram_id <= 0 or p_action not in ('login','create','link') or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_TELEGRAM'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kve-tg:'||p_telegram_id::text,0));
 select * into a from public.kve_telegram_accounts where telegram_id=p_telegram_id for update;
 if not found and p_action='login' then return jsonb_build_object('needs_registration',true); end if;
 if a.last_attempt > now()-interval '10 seconds' then raise exception 'KVE_TG_RATE'; end if;
 if p_action='link' then
   if p_link_user is null then raise exception 'NEED_ACCOUNT'; end if;
   if a.user_id is not null and a.user_id<>p_link_user then raise exception 'KVE_TG_CONFLICT'; end if;
   if exists(select 1 from public.kve_telegram_accounts where user_id=p_link_user and telegram_id<>p_telegram_id) then raise exception 'KVE_TG_CONFLICT'; end if;
 elsif p_link_user is not null then raise exception 'INVALID_TELEGRAM'; end if;
 -- TTL is longer than the accepted proof age. Only authentication receipts are removed.
 delete from public.kve_telegram_proofs where used_at<now()-interval '10 minutes';
 begin
   insert into public.kve_telegram_proofs(fingerprint) values(p_fingerprint);
 exception when unique_violation then raise exception 'KVE_TG_REPLAY'; end;
 if a.user_id is null then
   if p_action='link' then
     insert into public.kve_telegram_accounts(telegram_id,user_id,provisioned,last_attempt)
       values(p_telegram_id,p_link_user,true,now()) returning * into a;
   else
     fresh_id:=gen_random_uuid();
     insert into public.kve_telegram_accounts(telegram_id,user_id,email,last_attempt)
       values(p_telegram_id,fresh_id,'tg.'||fresh_id::text||'@kve.invalid',now()) returning * into a;
   end if;
 else
   update public.kve_telegram_accounts set last_attempt=now() where telegram_id=p_telegram_id returning * into a;
 end if;
 return jsonb_build_object('user_id',a.user_id,'email',a.email,'provisioned',a.provisioned);
end;
$$;
revoke all on function public.kve_telegram_claim(bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.kve_telegram_claim(bigint,text,text,uuid) to service_role;
