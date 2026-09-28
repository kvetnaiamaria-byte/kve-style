create or replace function kve_private.kve_save_library(p_document jsonb, p_expected_revision bigint)
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
  if current_revision <> p_expected_revision then raise exception 'KVE_CONFLICT' using errcode='P0001'; end if;
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
