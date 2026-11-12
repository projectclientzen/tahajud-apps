-- Row level security, grants, and function privileges (PRD v1.2 §18, SEC-03).
-- Rule of thumb: the browser role can READ its own rows and call a few RPCs. It can never write a table.

-- ---------- row level security on every table ----------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------- take back what Supabase hands out by default ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
-- PostgreSQL gives EXECUTE to PUBLIC on every new function. Only a schema-less revoke removes that default.
alter default privileges revoke execute on functions from public;

revoke all on schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
alter default privileges in schema app_private revoke all on functions from public, anon, authenticated;

-- The backend (service role) keeps full access. It bypasses RLS by design.
grant usage on schema public, app_private to service_role;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;

-- ---------- reads: own rows ----------
-- (select auth.uid()) is evaluated once per statement, not once per row.
drop policy if exists own_select on public.profiles;
create policy own_select on public.profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.user_devices;
create policy own_select on public.user_devices for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.access_entitlements;
create policy own_select on public.access_entitlements for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.night_sessions;
create policy own_select on public.night_sessions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.session_activities;
create policy own_select on public.session_activities for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.counter_operations;
create policy own_select on public.counter_operations for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.user_level_state;
create policy own_select on public.user_level_state for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.quran_reading_progress;
create policy own_select on public.quran_reading_progress for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.session_quran_completions;
create policy own_select on public.session_quran_completions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.notification_preferences;
create policy own_select on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.push_subscriptions;
create policy own_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));

grant select on public.profiles, public.user_devices, public.night_sessions, public.session_activities,
  public.counter_operations, public.user_level_state, public.quran_reading_progress,
  public.session_quran_completions, public.notification_preferences to authenticated;
-- Column grants keep secrets out of reach even for the owner of the row.
grant select (id, user_id, entitlement_type, status, starts_at, expires_at) on public.access_entitlements to authenticated;
grant select (id, user_id, device_id, is_active, created_at, last_success_at) on public.push_subscriptions to authenticated;

-- ---------- reads: shared content, only with an active entitlement ----------
-- Paid content (owner's Arabic text, Qur'an, schedules) is not readable by a signed-in user without access.
drop policy if exists paid_select on public.levels;
create policy paid_select on public.levels for select to authenticated
  using (public.has_active_entitlement((select auth.uid())));
drop policy if exists paid_select on public.activity_definitions;
create policy paid_select on public.activity_definitions for select to authenticated
  using (review_status = 'published' and public.has_active_entitlement((select auth.uid())));
drop policy if exists paid_select on public.level_activity_config;
create policy paid_select on public.level_activity_config for select to authenticated
  using (is_active and public.has_active_entitlement((select auth.uid())));
drop policy if exists paid_select on public.regions;
create policy paid_select on public.regions for select to authenticated
  using (is_supported and public.has_active_entitlement((select auth.uid())));
drop policy if exists paid_select on public.prayer_times;
create policy paid_select on public.prayer_times for select to authenticated
  using (public.has_active_entitlement((select auth.uid())));
drop policy if exists paid_select on public.quran_sources;
create policy paid_select on public.quran_sources for select to authenticated
  using (public.has_active_entitlement((select auth.uid())));
drop policy if exists paid_select on public.quran_surahs;
create policy paid_select on public.quran_surahs for select to authenticated
  using (public.has_active_entitlement((select auth.uid())));
drop policy if exists paid_select on public.quran_verses;
create policy paid_select on public.quran_verses for select to authenticated
  using (public.has_active_entitlement((select auth.uid())));

grant select on public.levels, public.activity_definitions, public.level_activity_config, public.regions,
  public.prayer_times, public.quran_sources, public.quran_surahs, public.quran_verses to authenticated;

-- ---------- no policies, no grants: backend only (PRD §18.3) ----------
-- webhook_events, purchase_orders, purchase_order_items, user_roles, app_settings, content_versions,
-- session_audit_logs, quran_translations, notification_templates, notification_jobs, notification_deliveries,
-- jobs, email_outbox, rate_limits, data_deletion_requests, admin_audit_logs.

-- ---------- RPC: the only way a user changes tracking data ----------
grant execute on function public.has_active_entitlement(uuid) to authenticated;
grant execute on function public.ensure_active_session() to authenticated;
grant execute on function public.set_checklist(uuid, boolean, int) to authenticated;
grant execute on function public.apply_counter_operation(uuid, text, text, int, timestamptz) to authenticated;
