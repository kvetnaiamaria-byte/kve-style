alter function public.kve_save_library(jsonb,bigint) set schema kve_private;
alter function public.kve_storage_usage() set schema kve_private;
revoke all on all functions in schema kve_private from public, anon;
grant execute on function kve_private.kve_save_library(jsonb,bigint), kve_private.kve_storage_usage(), kve_private.kve_can_delete_photo(text), kve_private.allow_upload(text,jsonb) to authenticated;
create function public.kve_save_library(p_document jsonb,p_expected_revision bigint) returns bigint language sql security invoker set search_path='' as $$ select kve_private.kve_save_library(p_document,p_expected_revision) $$;
create function public.kve_storage_usage() returns jsonb language sql security invoker set search_path='' as $$ select kve_private.kve_storage_usage() $$;
revoke all on function public.kve_save_library(jsonb,bigint),public.kve_storage_usage() from public,anon,authenticated;
grant execute on function public.kve_save_library(jsonb,bigint),public.kve_storage_usage() to authenticated;
