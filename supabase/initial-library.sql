-- Dedicated KVÉ project. Apply as the project administrator, never with a browser key.
begin;
create schema if not exists kve_private;
revoke all on schema kve_private from public, anon;
grant usage on schema kve_private to authenticated;
create table if not exists public.kve_libraries (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  document jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.kve_libraries enable row level security;
alter table public.kve_libraries force row level security;
revoke all on public.kve_libraries from anon, authenticated;
grant select on public.kve_libraries to authenticated;
drop policy if exists kve_read_own_library on public.kve_libraries;
create policy kve_read_own_library on public.kve_libraries for select to authenticated
  using (owner_id = (select auth.uid()));

create or replace function kve_private.kve_photo_refs(doc jsonb)
returns table(ref text) language sql immutable set search_path = '' as $$
  select jsonb_array_elements_text(coalesce(x->'photos','[]'::jsonb))
    from jsonb_array_elements(coalesce(doc->'looks','[]'::jsonb)) x
  union select x->>'photo' from jsonb_array_elements(coalesce(doc->'ideas','[]'::jsonb)) x where coalesce(x->>'photo','') <> ''
  union select x->>'photo' from jsonb_array_elements(coalesce(doc->'list','[]'::jsonb)) x where coalesce(x->>'photo','') <> ''
  union select value from jsonb_each_text(coalesce(doc->'folderCovers','{}'::jsonb)) where value <> ''
$$;
revoke all on function kve_private.kve_photo_refs(jsonb) from public;

create or replace function public.kve_save_library(p_document jsonb, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); current_revision bigint; image_ref text; object_name text;
begin
  if uid is null then raise exception 'KVE_AUTH_REQUIRED' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'KVE_INVALID_REVISION'; end if;
  if jsonb_typeof(p_document) is distinct from 'object'
    or p_document->>'schemaVersion' is distinct from '2'
    or jsonb_typeof(p_document->'looks') is distinct from 'array'
    or jsonb_typeof(p_document->'ideas') is distinct from 'array'
    or jsonb_typeof(p_document->'folders') is distinct from 'array'
    or jsonb_typeof(p_document->'list') is distinct from 'array'
    or jsonb_typeof(p_document->'folderCovers') is distinct from 'object'
    or octet_length(p_document::text) > 10485760 then raise exception 'KVE_INVALID_DOCUMENT'; end if;
  -- Same lock is used by the storage deletion policy, so a photo cannot disappear
  -- between this validation and committing a document that references it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
  select revision into current_revision from public.kve_libraries where owner_id=uid for update;
  current_revision := coalesce(current_revision,0);
  if current_revision <> p_expected_revision then raise exception 'KVE_CONFLICT' using errcode='40001'; end if;
  for image_ref in select ref from kve_private.kve_photo_refs(p_document) loop
    if image_ref !~ ('^kve-photo:' || uid::text || '/[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$') then
      raise exception 'KVE_INVALID_PHOTO' using errcode='42501';
    end if;
    object_name := substring(image_ref from 11);
    if not exists(select 1 from storage.objects where bucket_id='kve-photos' and name=object_name) then
      raise exception 'KVE_PHOTO_MISSING';
    end if;
  end loop;
  insert into public.kve_libraries(owner_id,revision,document) values(uid,current_revision+1,p_document)
  on conflict(owner_id) do update set revision=excluded.revision,document=excluded.document,updated_at=now();
  return current_revision+1;
end $$;
revoke all on function public.kve_save_library(jsonb,bigint) from public;
grant execute on function public.kve_save_library(jsonb,bigint) to authenticated;

create or replace function kve_private.kve_can_delete_photo(object_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); doc jsonb;
begin
  if uid is null or split_part(object_name,'/',1) <> uid::text then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
  select document into doc from public.kve_libraries where owner_id=uid;
  return not exists(select 1 from kve_private.kve_photo_refs(doc) where ref='kve-photo:'||object_name);
end $$;
revoke all on function kve_private.kve_can_delete_photo(text) from public;
grant execute on function kve_private.kve_can_delete_photo(text) to authenticated;

-- Quotas use the verified Auth email, never editable user_metadata.
create or replace function kve_private.photo_limit(uid uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from auth.users where id=uid and email_confirmed_at is not null
    and lower(email)='kvetnaiamaria@gmail.com') then 500000000::bigint else 50000000::bigint end
$$;
revoke all on function kve_private.photo_limit(uuid) from public;

create or replace function kve_private.allow_upload(object_name text, object_metadata jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=auth.uid(); bytes bigint; own_bytes bigint; total_bytes bigint;
begin
  if uid is null or object_name !~ ('^'||uid::text||'/[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$') then return false; end if;
  bytes := (object_metadata->>'size')::bigint;
  if bytes is null or bytes<=0 or bytes>5242880 then return false; end if;
  -- Serialize all uploads through the quota check. VOLATILE queries after this
  -- lock get a fresh READ COMMITTED snapshot, including prior committed uploads.
  perform pg_catalog.pg_advisory_xact_lock(712448619);
  select coalesce(sum((metadata->>'size')::bigint),0),
    coalesce(sum((metadata->>'size')::bigint) filter(where split_part(name,'/',1)=uid::text),0)
    into total_bytes,own_bytes from storage.objects where bucket_id='kve-photos';
  if own_bytes+bytes>kve_private.photo_limit(uid) then raise exception 'KVE_USER_QUOTA'; end if;
  if total_bytes+bytes>950000000 then raise exception 'KVE_PROJECT_QUOTA'; end if;
  return true;
end $$;
revoke all on function kve_private.allow_upload(text,jsonb) from public;
grant execute on function kve_private.allow_upload(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('kve-photos','kve-photos',false,5242880,array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists kve_photo_read on storage.objects;
create policy kve_photo_read on storage.objects for select to authenticated
  using(bucket_id='kve-photos' and (storage.foldername(name))[1]=(select auth.uid()::text));
drop policy if exists kve_photo_upload on storage.objects;
create policy kve_photo_upload on storage.objects for insert to authenticated
  with check(bucket_id='kve-photos' and kve_private.allow_upload(name,metadata));
-- No UPDATE policy: content-addressed files are immutable, never overwritten.
drop policy if exists kve_photo_delete on storage.objects;
create policy kve_photo_delete on storage.objects for delete to authenticated
  using(bucket_id='kve-photos' and kve_private.kve_can_delete_photo(name));

create or replace function public.kve_storage_usage()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); own_bytes bigint; total_bytes bigint;
begin
  if uid is null then raise exception 'KVE_AUTH_REQUIRED' using errcode='42501'; end if;
  select coalesce(sum((metadata->>'size')::bigint),0),
    coalesce(sum((metadata->>'size')::bigint) filter(where split_part(name,'/',1)=uid::text),0)
    into total_bytes,own_bytes from storage.objects where bucket_id='kve-photos';
  return jsonb_build_object('ownBytes',own_bytes,'projectBytes',total_bytes,'limitBytes',kve_private.photo_limit(uid),'projectLimitBytes',950000000);
end $$;
revoke all on function public.kve_storage_usage() from public;
grant execute on function public.kve_storage_usage() to authenticated;
commit;
