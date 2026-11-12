-- T3b: the four wrappers from T3a read the clock through app_private.server_now(), like every other wrapper.
-- Same behaviour in production. Tests can move the clock on their own database (see tests/db/harness.ts).

create or replace function public.has_active_entitlement(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_uid = auth.uid() and app_private.has_active_entitlement(p_uid, app_private.server_now())
$$;

create or replace function public.ensure_active_session() returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.ensure_active_session(auth.uid(), app_private.server_now())
$$;

create or replace function public.set_checklist(p_session_activity_id uuid, p_checked boolean, p_version int) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.set_checklist(auth.uid(), app_private.server_now(), p_session_activity_id, p_checked, p_version)
$$;

create or replace function public.apply_counter_operation(
  p_session_activity_id uuid, p_client_operation_id text, p_op_type text, p_delta int, p_client_recorded_at timestamptz
) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.apply_counter_operation(
    auth.uid(), app_private.server_now(), p_session_activity_id, p_client_operation_id, p_op_type, p_delta, p_client_recorded_at)
$$;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;
