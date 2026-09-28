begin;
-- Storage's permission preflight has MIME/contentLength rather than final size.
-- The final write uses its service role, so RLS alone cannot enforce byte limits.
create or replace function kve_private.allow_upload(object_name text, object_metadata jsonb)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from kve_private.photo_reservations
    where name=object_name and owner_id=(select auth.uid()))
$$;
create function kve_private.check_stored_photo_size()
returns trigger language plpgsql security definer set search_path='' as $$
declare reserved bigint; actual bigint;
begin
  if new.bucket_id <> 'kve-photos' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(712448619);
  select bytes into reserved from kve_private.photo_reservations where name=new.name;
  if reserved is null then raise exception 'KVE_RESERVATION_REQUIRED'; end if;
  -- The preflight runs as authenticated and is always rolled back. Actual
  -- persistence carries metadata.size; reject undersized reservations there.
  if new.metadata ? 'size' then
    actual:=(new.metadata->>'size')::bigint;
    if actual is null or actual<=0 or actual>reserved then raise exception 'KVE_SIZE_MISMATCH'; end if;
  elsif current_user <> 'authenticated' and current_setting('role',true) <> 'authenticated' then
    -- SECURITY DEFINER changes current_user. Storage preflight has role=authenticated.
    raise exception 'KVE_SIZE_REQUIRED';
  end if;
  return new;
end $$;
revoke all on function kve_private.check_stored_photo_size() from public,anon,authenticated;
create trigger kve_validate_photo_size before insert or update on storage.objects
for each row execute function kve_private.check_stored_photo_size();
commit;
