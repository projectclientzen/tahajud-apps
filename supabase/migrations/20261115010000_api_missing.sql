-- T3c: the endpoints that were still missing (PRD v1.2 §19.2, §19.3, §19.7, §24.4). Safe to run twice.
-- Same shape as T3b: business logic in app_private.*(p_uid, p_now, ...), thin public.* wrappers for the browser role
-- that pass auth.uid() and app_private.server_now(). Account export and deletion are backend only (service_role):
-- they must work for a user whose access ran out, and a user id never comes from the request body.

-- ---------- push subscriptions (PRD §19.7, SEC-14) ----------
-- A device that is logged out or removed must stop receiving pushes. Done in one place, on the device row, so
-- logout, "keluarkan perangkat", and any future admin revoke all behave the same.
create or replace function app_private.drop_push_for_revoked_device() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    delete from public.push_subscriptions where device_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists user_devices_drop_push on public.user_devices;
create trigger user_devices_drop_push after update of revoked_at on public.user_devices
  for each row execute function app_private.drop_push_for_revoked_device();

-- Keys (p256dh, auth) and the endpoint are never returned. The answer is only the id and when it was made.
create or replace function app_private.add_push_subscription(
  p_uid uuid, p_now timestamptz, p_device uuid, p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid; v_created timestamptz; v_max int := app_private.int_setting('push_max_subscriptions_per_user', 10);
begin
  perform app_private.require_active(p_uid, p_now);
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2048
     or p_p256dh is null or char_length(p_p256dh) not between 1 and 512
     or p_auth is null or char_length(p_auth) not between 1 and 512 then
    perform app_private.fail('VALIDATION_ERROR', 'subscription');
  end if;
  -- The device must be this user's, still signed in. Never trust an id that came from the browser.
  if p_device is not null and not exists (
      select 1 from public.user_devices d where d.id = p_device and d.user_id = p_uid and d.revoked_at is null) then
    p_device := null;
  end if;
  -- The same browser can be used by two people one after the other: the endpoint is the browser's, so the
  -- latest sign-in owns it. The old owner's row is replaced, never read by the new one.
  insert into public.push_subscriptions (user_id, device_id, endpoint, p256dh, auth, is_active, created_at, failure_count)
  values (p_uid, p_device, p_endpoint, p_p256dh, p_auth, true, p_now, 0)
  on conflict (endpoint) do update set
    user_id = excluded.user_id, device_id = excluded.device_id, p256dh = excluded.p256dh, auth = excluded.auth,
    is_active = true, failure_count = 0, created_at = excluded.created_at
  returning id, created_at into v_id, v_created;
  -- Stale browsers pile up. Keep the newest ones.
  delete from public.push_subscriptions s where s.user_id = p_uid and s.id in (
    select x.id from public.push_subscriptions x where x.user_id = p_uid order by x.created_at desc, x.id offset v_max);
  return pg_catalog.jsonb_build_object('id', v_id, 'is_active', true, 'created_at', app_private.iso(v_created));
end $$;

-- Only the owner can delete. Another user's id answers exactly like an id that does not exist (SECURITY-04).
-- No entitlement check: stopping notifications is always allowed.
create or replace function app_private.remove_push_subscription(p_uid uuid, p_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if p_uid is null then perform app_private.fail('UNAUTHENTICATED'); end if;
  delete from public.push_subscriptions where id = p_id and user_id = p_uid;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
end $$;

-- ---------- notification history (PRD §19.7) ----------
-- What was sent to this user. Jobs that were skipped, expired or are still waiting are not shown.
create or replace function app_private.list_notifications(p_uid uuid, p_now timestamptz, p_limit int) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  perform app_private.require_active(p_uid, p_now);
  return pg_catalog.jsonb_build_object('notifications', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', j.id, 'type', j.notification_type, 'sent_for', app_private.iso(j.scheduled_at),
      'title', t.title, 'body', t.body) order by j.scheduled_at desc, j.id)
    from (select * from public.notification_jobs n
          where n.user_id = p_uid and n.status = 'sent' and n.scheduled_at > p_now - interval '30 days'
          order by n.scheduled_at desc, n.id limit v_limit) j
    left join public.notification_templates t on t.id = j.template_id), '[]'::jsonb));
end $$;

-- ---------- prayer times (PRD §19.3) ----------
-- Stored rows only. A day without a row is not in the answer: nothing is invented. The API never calls a provider.
create or replace function app_private.get_prayer_times(
  p_uid uuid, p_now timestamptz, p_region uuid, p_from date, p_to date, p_maghrib boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_region uuid; r public.regions; v_from date; v_to date; v_max int := app_private.int_setting('prayer_times_max_days', 45);
begin
  perform app_private.require_active(p_uid, p_now);
  v_region := coalesce(p_region, (select p.region_id from public.profiles p where p.user_id = p_uid));
  if v_region is null then perform app_private.fail('LOCATION_REQUIRED'); end if;
  select * into r from public.regions where id = v_region and is_supported;
  if not found then perform app_private.fail('NOT_FOUND', 'region'); end if;
  v_from := coalesce(p_from, (p_now at time zone r.timezone)::date);
  v_to := coalesce(p_to, v_from);
  if v_to < v_from then perform app_private.fail('VALIDATION_ERROR', 'invalid_range'); end if;
  if v_to - v_from + 1 > v_max then perform app_private.fail('VALIDATION_ERROR', 'range_too_long'); end if;
  return pg_catalog.jsonb_build_object(
    'region', pg_catalog.jsonb_build_object('id', r.id, 'name', r.city_name, 'timezone', r.timezone),
    'days', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'local_date', d.local_date,
        'fajr_at', app_private.iso(d.fajr_at),
        'maghrib_at', case when p_maghrib and d.maghrib_at is not null then app_private.iso(d.maghrib_at) end,
        'source', 'provider',
        -- "cached" = stored, and past its refresh time. Still the provider's numbers, flagged as old.
        'cache_status', case when d.valid_until is null or d.valid_until >= p_now then 'fresh' else 'cached' end,
        'fetched_at', app_private.iso(d.fetched_at),
        'verification', d.verification,
        'attribution', d.attribution) order by d.local_date)
      from (select distinct on (t.local_date) t.* from public.prayer_times t
            where t.region_id = v_region and t.local_date between v_from and v_to
            order by t.local_date, t.fetched_at desc) d), '[]'::jsonb));
end $$;

-- ---------- export of a user's own data (PRD §24.4, PRIV-02) ----------
-- Not gated by entitlement: the data belongs to the user even after access ended. Secrets are left out:
-- no push endpoint or keys, no cookie hashes. Excused dates are the user's own data and are included for them.
create or replace function app_private.export_user_data(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.profiles;
begin
  if p_uid is null then perform app_private.fail('UNAUTHENTICATED'); end if;
  select * into p from public.profiles where user_id = p_uid;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  return pg_catalog.jsonb_build_object(
    'format_version', 1,
    'exported_at', app_private.iso(p_now),
    'account', pg_catalog.jsonb_build_object(
      'email', p.email_normalized, 'display_name', p.display_name, 'created_at', app_private.iso(p.created_at),
      'region', (select pg_catalog.jsonb_build_object('id', r.id, 'name', r.city_name, 'timezone', r.timezone)
                 from public.regions r where r.id = p.region_id),
      'manual_schedule', p.manual_schedule, 'program_start_date', p.program_start_date,
      'onboarding_completed', p.onboarding_completed, 'theme_pref', p.theme_pref,
      'quran_font_size', p.quran_font_size, 'dhikr_font_size', p.dhikr_font_size),
    'access', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'status', e.status, 'entitlement_type', e.entitlement_type, 'starts_at', app_private.iso(e.starts_at),
        'expires_at', case when e.expires_at is null then null else app_private.iso(e.expires_at) end) order by e.starts_at)
      from public.access_entitlements e where e.user_id = p_uid), '[]'::jsonb),
    'purchases', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'order_id', o.scalev_order_id, 'payment_status', o.payment_status, 'amount', o.amount, 'currency', o.currency,
        'created_at', app_private.iso(o.created_at),
        'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'product_id', i.product_id, 'variant_id', i.variant_id, 'quantity', i.quantity))
          from public.purchase_order_items i where i.purchase_order_id = o.id), '[]'::jsonb)) order by o.created_at)
      from public.purchase_orders o where o.customer_email_normalized = p.email_normalized), '[]'::jsonb),
    'level_state', (select pg_catalog.jsonb_build_object(
        'current_level', l.current_level,
        'level_1_unlocked_at', case when l.level_1_unlocked_at is null then null else app_private.iso(l.level_1_unlocked_at) end,
        'level_2_unlocked_at', case when l.level_2_unlocked_at is null then null else app_private.iso(l.level_2_unlocked_at) end,
        'level_3_unlocked_at', case when l.level_3_unlocked_at is null then null else app_private.iso(l.level_3_unlocked_at) end,
        'level_2_effective_from', l.level_2_effective_from, 'level_3_effective_from', l.level_3_effective_from,
        'journey_completed_at', case when l.journey_completed_at is null then null else app_private.iso(l.journey_completed_at) end)
      from public.user_level_state l where l.user_id = p_uid),
    'sessions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'session_key', s.fajr_local_date, 'timezone', s.timezone, 'level', s.level_number, 'status', s.status,
        'schedule_source', s.schedule_source,
        'started_at', case when s.started_at is null then null else app_private.iso(s.started_at) end,
        'completed_at', case when s.completed_at is null then null else app_private.iso(s.completed_at) end,
        'closed_at', case when s.closed_at is null then null else app_private.iso(s.closed_at) end,
        'activities', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'key', a.activity_config_snapshot ->> 'activity_key', 'phase', a.phase,
            'title', a.activity_config_snapshot ->> 'title', 'target', a.target_count, 'count', a.actual_count,
            'required', a.required_for_completion, 'status', a.status,
            'completed_at', case when a.completed_at is null then null else app_private.iso(a.completed_at) end,
            'operations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'operation_id', o.client_operation_id, 'type', o.op_type, 'delta', o.delta,
                'resulting_count', o.resulting_count,
                'client_recorded_at', case when o.client_recorded_at is null then null else app_private.iso(o.client_recorded_at) end,
                'applied_at', app_private.iso(o.server_applied_at)) order by o.server_applied_at, o.id)
              from public.counter_operations o where o.session_activity_id = a.id), '[]'::jsonb)
          ) order by a.phase, a.id)
          from public.session_activities a where a.session_id = s.id), '[]'::jsonb)) order by s.fajr_local_date)
      from public.night_sessions s where s.user_id = p_uid), '[]'::jsonb),
    'excused_dates', coalesce((select pg_catalog.jsonb_agg(x.excused_date order by x.excused_date)
      from public.session_excuses x where x.user_id = p_uid), '[]'::jsonb),
    'quran_progress', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'surah', q.surah_number, 'ayah', q.last_verse, 'status', q.status, 'updated_at', app_private.iso(q.updated_at),
        'completed_at', case when q.completed_at is null then null else app_private.iso(q.completed_at) end)
        order by q.surah_number)
      from public.quran_reading_progress q where q.user_id = p_uid), '[]'::jsonb),
    'quran_completions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'session_key', s.fajr_local_date, 'surah', c.surah_number, 'type', c.completion_type,
        'completed_at', app_private.iso(c.completed_at)) order by c.completed_at, c.surah_number)
      from public.session_quran_completions c join public.night_sessions s on s.id = c.session_id
      where c.user_id = p_uid), '[]'::jsonb),
    'notification_preferences', (select app_private.notification_prefs_json(p_uid)),
    'push_subscriptions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', s.id, 'is_active', s.is_active, 'created_at', app_private.iso(s.created_at)) order by s.created_at)
      from public.push_subscriptions s where s.user_id = p_uid), '[]'::jsonb),
    'devices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', d.id, 'label', d.label, 'last_seen_at', app_private.iso(d.last_seen_at),
        'revoked_at', case when d.revoked_at is null then null else app_private.iso(d.revoked_at) end)
        order by d.last_seen_at desc, d.id)
      from public.user_devices d where d.user_id = p_uid), '[]'::jsonb),
    'notifications', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'type', j.notification_type, 'local_date', j.local_schedule_date, 'scheduled_at', app_private.iso(j.scheduled_at),
        'status', j.status) order by j.scheduled_at, j.id)
      from public.notification_jobs j where j.user_id = p_uid), '[]'::jsonb));
end $$;

-- ---------- delete account (PRD §24.4, PRIV-02) ----------
-- Worship data, profile, push, Qur'an progress, devices and notification history go (they cascade from auth.users).
-- Orders and entitlements stay for the business records with the email replaced by the hash the caller computed
-- (keyed hash, so it cannot be looked up from a list of emails). The user id is cut from them.
-- SECURITY DEFINER: deleting from auth.users must work whatever privileges the connection's role has on that schema.
create or replace function app_private.delete_account(p_uid uuid, p_now timestamptz, p_email_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if p_uid is null then perform app_private.fail('UNAUTHENTICATED'); end if;
  if p_email_hash is null or char_length(p_email_hash) < 16 then perform app_private.fail('VALIDATION_ERROR', 'hash'); end if;
  select p.email_normalized into v_email from public.profiles p where p.user_id = p_uid;
  if not found then perform app_private.fail('NOT_FOUND'); end if;

  update public.access_entitlements set user_id = null, email_normalized = p_email_hash
  where user_id = p_uid or email_normalized = v_email;
  update public.access_entitlements set transferred_from_email = p_email_hash where transferred_from_email = v_email;
  update public.purchase_orders set customer_email_normalized = p_email_hash, buyer_name = null
  where customer_email_normalized = v_email;

  -- Copies of the address outside the tables above.
  update public.email_outbox set to_email = p_email_hash, payload = '{}'::jsonb where lower(to_email) = v_email;
  update public.webhook_events set payload_minimal =
    regexp_replace(payload_minimal::text, regexp_replace(v_email, '([.+*?^$(){}|\[\]\\])', '\\\1', 'g'), p_email_hash, 'gi')::jsonb
  where position(v_email in lower(payload_minimal::text)) > 0;
  -- Work still waiting for this person must not run: no email to a deleted account, no push to its devices.
  delete from public.jobs where status in ('queued', 'failed')
    and (payload ->> 'user_id' = p_uid::text or lower(payload ->> 'email') = v_email);
  update public.session_audit_logs set actor_id = null where actor_id = p_uid;

  insert into public.data_deletion_requests (user_id, requested_at, processed_at, status)
  values (p_uid, p_now, p_now, 'done');
  delete from auth.users where id = p_uid;
  return pg_catalog.jsonb_build_object('deleted_at', app_private.iso(p_now));
end $$;

-- ---------- wrappers for the browser role ----------
create or replace function public.add_push_subscription(p_device uuid, p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.add_push_subscription(auth.uid(), app_private.server_now(), p_device, p_endpoint, p_p256dh, p_auth)
$$;
create or replace function public.remove_push_subscription(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  select app_private.remove_push_subscription(auth.uid(), p_id)
$$;
create or replace function public.list_notifications(p_limit int default 20) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.list_notifications(auth.uid(), app_private.server_now(), p_limit)
$$;
create or replace function public.get_prayer_times(p_region uuid default null, p_from date default null,
  p_to date default null, p_maghrib boolean default false) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_prayer_times(auth.uid(), app_private.server_now(), p_region, p_from, p_to, p_maghrib)
$$;

grant execute on function public.add_push_subscription(uuid, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(uuid) to authenticated;
grant execute on function public.list_notifications(int) to authenticated;
grant execute on function public.get_prayer_times(uuid, date, date, boolean) to authenticated;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;
