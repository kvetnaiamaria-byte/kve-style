-- Transactional fixtures: no real users/photos created; always rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','kve-test-one@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000002','kve-test-two@example.invalid',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.kve_save_library('{"schemaVersion":2,"looks":[],"ideas":[],"folders":[],"list":[],"folderCovers":{}}',0);
do $$begin
  begin
    perform public.kve_save_library('{"schemaVersion":2,"looks":[],"ideas":[],"folders":[],"list":[],"folderCovers":{}}',0);
    raise exception 'TEST_FAILED_stale_write';
  exception when raise_exception then if sqlerrm<>'KVE_CONFLICT' then raise; end if; end;
  if (public.kve_storage_usage()->>'limitBytes')::bigint <> 50000000 then raise exception 'TEST_FAILED_limit'; end if;
end $$;
select public.kve_reserve_photo('10000000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg',5000000);
insert into storage.objects(bucket_id,name,metadata) values('kve-photos','10000000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg','{"size":5000000}');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$begin
  if exists(select 1 from public.kve_libraries) then raise exception 'TEST_FAILED_library_leak'; end if;
  if exists(select 1 from storage.objects where bucket_id='kve-photos') then raise exception 'TEST_FAILED_photo_leak'; end if;
  begin
    perform public.kve_reserve_photo('10000000-0000-4000-8000-000000000001/'||repeat('b',64)||'.jpg',1);
    raise exception 'TEST_FAILED_foreign_upload';
  exception when insufficient_privilege then null; end;
  begin
    perform public.kve_save_library(jsonb_build_object('schemaVersion',2,'looks',jsonb_build_array(jsonb_build_object('photos',jsonb_build_array('kve-photo:10000000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg'))),'ideas','[]'::jsonb,'folders','[]'::jsonb,'list','[]'::jsonb,'folderCovers','{}'::jsonb),0);
    raise exception 'TEST_FAILED_foreign_ref';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$declare i int; begin
  for i in 1..9 loop
    perform public.kve_reserve_photo('10000000-0000-4000-8000-000000000001/'||lpad(i::text,64,'0')||'.jpg',5000000);
  end loop;
  begin
    perform public.kve_reserve_photo('10000000-0000-4000-8000-000000000001/'||repeat('c',64)||'.jpg',1);
    raise exception 'TEST_FAILED_quota';
  exception when raise_exception then
    if sqlerrm <> 'KVE_USER_QUOTA' then raise; end if;
  end;
end $$;
select 'PASS: owner isolation, upload ownership, 50 MB quota, foreign reference rejection, concurrent revision protection' as result;
rollback;
