begin;
create table kve_private.photo_reservations (
  name text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  bytes bigint not null check(bytes>0 and bytes<=5242880),
  created_at timestamptz not null default now()
);
alter table kve_private.photo_reservations enable row level security;
revoke all on kve_private.photo_reservations from public,anon,authenticated;
create index photo_reservations_owner on kve_private.photo_reservations(owner_id);
create function kve_private.reserve_photo(p_name text,p_bytes bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); total_bytes bigint; own_bytes bigint; old_bytes bigint;
begin
  if uid is null or p_name is null or p_name !~ ('^'||uid::text||'/[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$') then raise exception 'KVE_INVALID_PHOTO' using errcode='42501'; end if;
  if p_bytes is null or p_bytes<=0 or p_bytes>5242880 then raise exception 'KVE_INVALID_SIZE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(712448619);
  select bytes into old_bytes from kve_private.photo_reservations where name=p_name;
  if old_bytes is not null then
    if old_bytes<>p_bytes then raise exception 'KVE_SIZE_MISMATCH'; end if;
    return true;
  end if;
  select coalesce(sum(bytes),0),coalesce(sum(bytes) filter(where owner_id=uid),0)
    into total_bytes,own_bytes from kve_private.photo_reservations;
  if own_bytes+p_bytes>kve_private.photo_limit(uid) then raise exception 'KVE_USER_QUOTA'; end if;
  if total_bytes+p_bytes>950000000 then raise exception 'KVE_PROJECT_QUOTA'; end if;
  insert into kve_private.photo_reservations(name,owner_id,bytes) values(p_name,uid,p_bytes);
  return true;
end $$;
create function public.kve_reserve_photo(p_name text,p_bytes bigint)
returns boolean language sql security invoker set search_path='' as $$select kve_private.reserve_photo(p_name,p_bytes)$$;
create or replace function kve_private.allow_upload(object_name text, object_metadata jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare reserved bigint;
begin
  if auth.uid() is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(712448619);
  select bytes into reserved from kve_private.photo_reservations where name=object_name and owner_id=auth.uid();
  -- Storage preflights INSERT without metadata, then checks again with real size.
  return reserved is not null and (object_metadata is null or
    ((object_metadata->>'size')::bigint > 0 and (object_metadata->>'size')::bigint <= reserved));
end $$;
create function kve_private.release_photo(p_name text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'KVE_AUTH_REQUIRED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(712448619);
  if exists(select 1 from storage.objects where bucket_id='kve-photos' and name=p_name) then return false; end if;
  delete from kve_private.photo_reservations where name=p_name and owner_id=auth.uid();
  return found;
end $$;
create function public.kve_release_photo(p_name text)
returns boolean language sql security invoker set search_path='' as $$select kve_private.release_photo(p_name)$$;
create or replace function kve_private.kve_storage_usage()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); own_bytes bigint; total_bytes bigint;
begin
  if uid is null then raise exception 'KVE_AUTH_REQUIRED' using errcode='42501'; end if;
  select coalesce(sum(bytes),0),coalesce(sum(bytes) filter(where owner_id=uid),0)
    into total_bytes,own_bytes from kve_private.photo_reservations;
  return jsonb_build_object('ownBytes',own_bytes,'projectBytes',total_bytes,'limitBytes',kve_private.photo_limit(uid),'projectLimitBytes',950000000);
end $$;
revoke all on function kve_private.reserve_photo(text,bigint),kve_private.release_photo(text),public.kve_reserve_photo(text,bigint),public.kve_release_photo(text) from public,anon,authenticated;
grant execute on function kve_private.reserve_photo(text,bigint),kve_private.release_photo(text),public.kve_reserve_photo(text,bigint),public.kve_release_photo(text) to authenticated;
commit;
