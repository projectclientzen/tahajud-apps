-- T3b: write functions, auth plumbing and rate limiting for /api/v1 (PRD v1.2 §19, §24.1). Safe to run twice.
-- Two kinds of function:
--   public.*      called as the signed-in user (role authenticated). They use auth.uid() and the server clock.
--   app_private.* called only by the backend (role service_role) before a user is known, or on behalf of one.

-- ---------- schema additions ----------
alter table public.notification_preferences add column if not exists achievement_enabled boolean not null default true;
alter table public.notification_preferences add column if not exists quiet_hours_enabled boolean not null default false;

-- The sign-in cookie of one device. Only a hash is stored. Backend only: no grants (PRD §24.1).
create table if not exists public.device_sessions (
  device_id uuid primary key references public.user_devices (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- One row per email: the latest code, as a hash. Used by the local OTP provider. Backend only.
create table if not exists public.login_otps (
  email_hash text primary key,
  code_hash text not null,
  issued_at timestamptz not null,
  attempts int not null default 0,
  consumed boolean not null default false
);

-- Permission to remove one device after a correct code on a 4th device (PRD §24.1). Lives 10 minutes, works once.
create table if not exists public.pending_logins (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.device_sessions enable row level security;
alter table public.login_otps enable row level security;
alter table public.pending_logins enable row level security;
revoke all on public.device_sessions, public.login_otps, public.pending_logins from anon, authenticated;

-- ---------- settings ----------
create or replace function app_private.int_setting(p_key text, p_default int) returns int
language sql stable set search_path = '' as $$
  select coalesce((app_private.setting(p_key) #>> '{}')::int, p_default)
$$;

-- ---------- rate limiting (fixed windows, PRD §24.1) ----------
-- The caller hashes anything personal (email, IP) before it becomes a key.
create or replace function app_private.rate_hit(p_key text, p_now timestamptz, p_window_seconds int, p_limit int) returns jsonb
language plpgsql set search_path = '' as $$
declare v_start timestamptz; v_count int;
begin
  v_start := pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch', p_now) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (key, window_start, count) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  -- Old windows are of no use. Keeps the table small without a job.
  delete from public.rate_limits where window_start < p_now - interval '1 day' and key = p_key;
  return pg_catalog.jsonb_build_object(
    'allowed', v_count <= p_limit,
    'retry_after_seconds', greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', v_start + pg_catalog.make_interval(secs => p_window_seconds) - p_now))::int));
end $$;

-- ---------- OTP codes (local provider) ----------
-- Returns {ok} or {ok:false, reason:'cooldown'|'hourly_limit', retry_after_seconds}. Same rules as src/domain/auth/otp.ts.
create or replace function app_private.otp_issue(p_email_hash text, p_code_hash text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare o public.login_otps; hit jsonb; v_wait int;
begin
  select * into o from public.login_otps where email_hash = p_email_hash for update;
  if found then
    v_wait := pg_catalog.ceil(pg_catalog.date_part('epoch', o.issued_at + interval '60 seconds' - p_now))::int;
    if v_wait > 0 then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'cooldown', 'retry_after_seconds', v_wait);
    end if;
  end if;
  hit := app_private.rate_hit('otp:email:' || p_email_hash, p_now, 3600, 5);
  if not (hit ->> 'allowed')::boolean then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'hourly_limit', 'retry_after_seconds', (hit ->> 'retry_after_seconds')::int);
  end if;
  insert into public.login_otps (email_hash, code_hash, issued_at, attempts, consumed)
  values (p_email_hash, p_code_hash, p_now, 0, false)
  on conflict (email_hash) do update set code_hash = excluded.code_hash, issued_at = excluded.issued_at,
    attempts = 0, consumed = false;
  return pg_catalog.jsonb_build_object('ok', true);
end $$;

-- True when the code is right. A wrong code costs one attempt, 5 kill the code, a right code works once (PRD §24.1).
-- Returns a value instead of raising, so the attempt count survives.
create or replace function app_private.otp_verify(p_email_hash text, p_code_hash text, p_now timestamptz) returns boolean
language plpgsql set search_path = '' as $$
declare o public.login_otps;
begin
  select * into o from public.login_otps where email_hash = p_email_hash for update;
  if not found or o.consumed then return false; end if;
  if p_now - o.issued_at > interval '10 minutes' then return false; end if;
  if o.attempts >= 5 then return false; end if;
  if o.code_hash <> p_code_hash then
    update public.login_otps set attempts = attempts + 1 where email_hash = p_email_hash;
    return false;
  end if;
  update public.login_otps set consumed = true where email_hash = p_email_hash;
  return true;
end $$;

-- ---------- account provisioning ----------
-- Called after the mailbox is proven. The auth user already exists (Supabase Auth, or the local provider in tests).
-- Creates the profile and links purchases made with this email (PRD §6.1).
create or replace function app_private.provision_user(p_uid uuid, p_email text, p_now timestamptz) returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.profiles (user_id, email_normalized) values (p_uid, p_email) on conflict (user_id) do nothing;
  update public.access_entitlements set user_id = p_uid
  where email_normalized = p_email and user_id is null;
end $$;

create or replace function app_private.get_access(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_status text; v_done boolean; v_exp timestamptz; v_active boolean;
begin
  v_active := app_private.has_active_entitlement(p_uid, p_now);
  select e.expires_at into v_exp from public.access_entitlements e
    where e.user_id = p_uid and e.status = 'active' order by e.starts_at desc limit 1;
  v_status := case
    when v_active then 'active'
    when exists (select 1 from public.access_entitlements e where e.user_id = p_uid and e.status = 'pending_verification')
      then 'awaiting_order_verification'
    when exists (select 1 from public.access_entitlements e where e.user_id = p_uid and e.status in ('suspended', 'revoked'))
      then 'suspended'
    else 'none' end;
  select coalesce(p.onboarding_completed, false) into v_done from public.profiles p where p.user_id = p_uid;
  return pg_catalog.jsonb_build_object(
    'authenticated', true,
    'access_status', v_status,
    'entitlement_type', case when v_active then 'lifetime' end,
    'expires_at', case when v_active and v_exp is not null then app_private.iso(v_exp) end,
    'onboarding_completed', v_active and coalesce(v_done, false));
end $$;

-- ---------- devices and sessions (PRD §24.1) ----------
create or replace function app_private.devices_json(p_uid uuid, p_current uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', d.id, 'label', d.label, 'last_seen_at', app_private.iso(d.last_seen_at), 'is_current', coalesce(d.id = p_current, false))
    order by d.last_seen_at desc), '[]'::jsonb)
  from public.user_devices d where d.user_id = p_uid and d.revoked_at is null
$$;

-- New device + cookie hash. Refused (no row written) when the user already has the maximum number of active devices.
create or replace function app_private.start_device_session(p_uid uuid, p_label text, p_token_hash text, p_now timestamptz)
returns jsonb
language plpgsql set search_path = '' as $$
declare v_max int; v_active int; v_id uuid; v_exp timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_uid::text));
  v_max := app_private.int_setting('max_active_devices', 3);
  select count(*) into v_active from public.user_devices where user_id = p_uid and revoked_at is null;
  if v_active >= v_max then
    return pg_catalog.jsonb_build_object('status', 'device_limit', 'max_devices', v_max);
  end if;
  v_exp := p_now + pg_catalog.make_interval(days => app_private.int_setting('session_days', 30));
  insert into public.user_devices (user_id, label, last_seen_at) values (p_uid, p_label, p_now) returning id into v_id;
  insert into public.device_sessions (device_id, user_id, token_hash, issued_at, expires_at)
  values (v_id, p_uid, p_token_hash, p_now, v_exp);
  return pg_catalog.jsonb_build_object('status', 'ok', 'device_id', v_id, 'expires_at', app_private.iso(v_exp));
end $$;

create or replace function app_private.create_pending_login(p_uid uuid, p_token_hash text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare v_exp timestamptz := p_now + interval '10 minutes';
begin
  -- A fresh code replaces older permissions for the same user.
  delete from public.pending_logins where user_id = p_uid and used_at is null;
  insert into public.pending_logins (token_hash, user_id, created_at, expires_at) values (p_token_hash, p_uid, p_now, v_exp);
  return pg_catalog.jsonb_build_object('pending_expires_at', app_private.iso(v_exp), 'devices', app_private.devices_json(p_uid, null));
end $$;

-- Removes one device, uses up the permission, and signs the new device in. All or nothing.
create or replace function app_private.complete_pending_login(
  p_token_hash text, p_revoke_device_id uuid, p_label text, p_session_hash text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare pl public.pending_logins; v_res jsonb;
begin
  select * into pl from public.pending_logins where token_hash = p_token_hash for update;
  if not found or pl.used_at is not null or pl.expires_at < p_now then perform app_private.fail('PENDING_LOGIN_INVALID'); end if;
  update public.user_devices set revoked_at = p_now
    where id = p_revoke_device_id and user_id = pl.user_id and revoked_at is null;
  if not found then perform app_private.fail('NOT_FOUND', 'device'); end if;
  update public.pending_logins set used_at = p_now where token_hash = p_token_hash;
  v_res := app_private.start_device_session(pl.user_id, p_label, p_session_hash, p_now);
  return v_res || pg_catalog.jsonb_build_object('user_id', pl.user_id);
end $$;

-- What a cookie means right now. Extends the session while the device is in use (30 days, sliding).
create or replace function app_private.resolve_session(p_device_id uuid, p_token_hash text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare s public.device_sessions; d public.user_devices; v_email text; v_exp timestamptz;
begin
  select * into s from public.device_sessions where device_id = p_device_id;
  select * into d from public.user_devices where id = p_device_id;
  -- A wrong secret reads the same as no session. Never says whether the device exists.
  if s.device_id is null or s.token_hash <> p_token_hash then
    return pg_catalog.jsonb_build_object('state', 'none');
  end if;
  if d.revoked_at is not null then return pg_catalog.jsonb_build_object('state', 'revoked'); end if;
  if s.expires_at <= p_now then return pg_catalog.jsonb_build_object('state', 'expired'); end if;
  v_exp := s.expires_at;
  if p_now - d.last_seen_at > interval '5 minutes' then
    v_exp := p_now + pg_catalog.make_interval(days => app_private.int_setting('session_days', 30));
    update public.user_devices set last_seen_at = p_now where id = d.id;
    update public.device_sessions set expires_at = v_exp where device_id = d.id;
  end if;
  select p.email_normalized into v_email from public.profiles p where p.user_id = s.user_id;
  return pg_catalog.jsonb_build_object('state', 'ok', 'user_id', s.user_id, 'email', v_email,
    'device_id', d.id, 'expires_at', app_private.iso(v_exp));
end $$;

-- A revoked device keeps its cookie hash on purpose: the cookie then reads as "revoked", not as "never signed in" (PRD §24.1).
create or replace function app_private.logout_device(p_uid uuid, p_device_id uuid, p_now timestamptz) returns void
language sql set search_path = '' as $$
  update public.user_devices set revoked_at = p_now where id = p_device_id and user_id = p_uid and revoked_at is null
$$;

create or replace function app_private.revoke_device(p_uid uuid, p_current uuid, p_target uuid, p_now timestamptz) returns void
language plpgsql set search_path = '' as $$
begin
  if p_target = p_current then perform app_private.fail('VALIDATION_ERROR', 'current device'); end if;
  update public.user_devices set revoked_at = p_now where id = p_target and user_id = p_uid and revoked_at is null;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
end $$;

-- ---------- profile, location, onboarding, display preferences ----------
create or replace function app_private.profile_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'user_id', p.user_id,
    'display_name', p.display_name,
    'region_id', p.region_id,
    'schedule_mode', case when p.manual_schedule is not null and p.region_id is null then 'manual' else 'region' end,
    'timezone', coalesce(app_private.user_timezone(p.user_id), 'Asia/Jakarta'),
    'program_start_date', case when p.onboarding_completed then p.program_start_date end,
    'onboarding_completed', p.onboarding_completed,
    'theme_pref', p.theme_pref,
    'quran_font_size', p.quran_font_size,
    'dhikr_font_size', p.dhikr_font_size)
  from public.profiles p where p.user_id = p_uid
$$;

create or replace function app_private.get_profile(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return app_private.profile_json(p_uid);
end $$;

create or replace function app_private.update_profile(p_uid uuid, p_now timestamptz, p_display_name text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_name text := nullif(pg_catalog.btrim(coalesce(p_display_name, '')), '');
begin
  perform app_private.require_active(p_uid, p_now);
  if v_name is not null and pg_catalog.char_length(v_name) > 60 then perform app_private.fail('VALIDATION_ERROR', 'display_name'); end if;
  update public.profiles set display_name = v_name where user_id = p_uid;
  return app_private.profile_json(p_uid);
end $$;

create or replace function app_private.update_preferences(
  p_uid uuid, p_now timestamptz, p_theme text, p_quran int, p_dhikr int
) returns jsonb
language plpgsql set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  if p_theme is not null and p_theme not in ('system', 'light', 'dark', 'auto-night') then perform app_private.fail('VALIDATION_ERROR', 'theme'); end if;
  if p_quran is not null and p_quran not between 24 and 44 then perform app_private.fail('VALIDATION_ERROR', 'quran_font_size'); end if;
  if p_dhikr is not null and p_dhikr not between 26 and 34 then perform app_private.fail('VALIDATION_ERROR', 'dhikr_font_size'); end if;
  update public.profiles set
    theme_pref = coalesce(p_theme, theme_pref),
    quran_font_size = coalesce(p_quran, quran_font_size),
    dhikr_font_size = coalesce(p_dhikr, dhikr_font_size)
  where user_id = p_uid;
  return app_private.profile_json(p_uid);
end $$;

-- Takes effect from the next session. Rows that already exist keep their frozen zone and region (PRD §11.5).
create or replace function app_private.set_location(
  p_uid uuid, p_now timestamptz, p_mode text, p_region_id uuid, p_timezone text, p_fajr text, p_maghrib text
) returns void
language plpgsql set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  if p_mode = 'region' then
    if not exists (select 1 from public.regions r where r.id = p_region_id and r.is_supported) then
      perform app_private.fail('NOT_FOUND', 'region');
    end if;
    update public.profiles set region_id = p_region_id, manual_schedule = null where user_id = p_uid;
  elsif p_mode = 'manual' then
    if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
      perform app_private.fail('VALIDATION_ERROR', 'timezone');
    end if;
    if p_fajr is null or p_fajr !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (p_maghrib is not null and p_maghrib !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      perform app_private.fail('VALIDATION_ERROR', 'time');
    end if;
    update public.profiles set region_id = null,
      manual_schedule = pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('timezone', p_timezone, 'fajr', p_fajr, 'maghrib', p_maghrib))
    where user_id = p_uid;
  else
    perform app_private.fail('VALIDATION_ERROR', 'mode');
  end if;
end $$;

-- program_start_date = the first session the user can still do. A second call changes nothing (S2-3).
create or replace function app_private.complete_onboarding(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare p public.profiles; v_tz text; v_key date;
begin
  perform app_private.require_active(p_uid, p_now);
  select * into p from public.profiles where user_id = p_uid for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  if not p.onboarding_completed then
    v_tz := app_private.user_timezone(p_uid);
    if v_tz is null then perform app_private.fail('LOCATION_REQUIRED'); end if;
    v_key := app_private.active_session_key(p_now, v_tz);
    update public.profiles set onboarding_completed = true, program_start_date = v_key where user_id = p_uid;
    insert into public.user_level_state (user_id, level_1_unlocked_at) values (p_uid, p_now) on conflict (user_id) do nothing;
  end if;
  return app_private.profile_json(p_uid);
end $$;

-- ---------- notification preferences ----------
create or replace function app_private.notification_prefs_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'bedtime', pg_catalog.jsonb_build_object('enabled', coalesce(n.bedtime_enabled, true),
      'target_sleep_time', pg_catalog.to_char(coalesce(n.bedtime_local_time, time '22:00'), 'HH24:MI'),
      'offset_minutes', coalesce(n.bedtime_offset_minutes, 30)),
    'tahajud', pg_catalog.jsonb_build_object('enabled', coalesce(n.tahajud_enabled, true)),
    'fajr', pg_catalog.jsonb_build_object('enabled', coalesce(n.fajr_enabled, true)),
    'alkahfi', pg_catalog.jsonb_build_object('enabled', coalesce(n.alkahfi_enabled, true)),
    'achievement', pg_catalog.jsonb_build_object('enabled', coalesce(n.achievement_enabled, true)),
    'quiet_hours', pg_catalog.jsonb_build_object('enabled', coalesce(n.quiet_hours_enabled, false),
      'start', pg_catalog.to_char(coalesce(n.quiet_hours_start, time '22:00'), 'HH24:MI'),
      'end', pg_catalog.to_char(coalesce(n.quiet_hours_end, time '04:00'), 'HH24:MI'),
      'allow_worship', coalesce(n.quiet_hours_allow_worship, true)))
  from (select 1) one left join public.notification_preferences n on n.user_id = p_uid
$$;

create or replace function app_private.get_notification_prefs(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return app_private.notification_prefs_json(p_uid);
end $$;

create or replace function app_private.put_notification_prefs(p_uid uuid, p_now timestamptz, p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  insert into public.notification_preferences (
    user_id, bedtime_enabled, bedtime_local_time, bedtime_offset_minutes, tahajud_enabled, fajr_enabled, alkahfi_enabled,
    achievement_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_allow_worship, updated_at)
  values (
    p_uid, (p #>> '{bedtime,enabled}')::boolean, (p #>> '{bedtime,target_sleep_time}')::time,
    (p #>> '{bedtime,offset_minutes}')::int, (p #>> '{tahajud,enabled}')::boolean, (p #>> '{fajr,enabled}')::boolean,
    (p #>> '{alkahfi,enabled}')::boolean, (p #>> '{achievement,enabled}')::boolean,
    (p #>> '{quiet_hours,enabled}')::boolean, (p #>> '{quiet_hours,start}')::time, (p #>> '{quiet_hours,end}')::time,
    (p #>> '{quiet_hours,allow_worship}')::boolean, p_now)
  on conflict (user_id) do update set
    bedtime_enabled = excluded.bedtime_enabled, bedtime_local_time = excluded.bedtime_local_time,
    bedtime_offset_minutes = excluded.bedtime_offset_minutes, tahajud_enabled = excluded.tahajud_enabled,
    fajr_enabled = excluded.fajr_enabled, alkahfi_enabled = excluded.alkahfi_enabled,
    achievement_enabled = excluded.achievement_enabled, quiet_hours_enabled = excluded.quiet_hours_enabled,
    quiet_hours_start = excluded.quiet_hours_start, quiet_hours_end = excluded.quiet_hours_end,
    quiet_hours_allow_worship = excluded.quiet_hours_allow_worship, updated_at = excluded.updated_at;
  return app_private.notification_prefs_json(p_uid);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or check_violation then
  perform app_private.fail('VALIDATION_ERROR', 'preferences');
  return null;
end $$;

-- ---------- Qur'an reading position (no text lives here) ----------
create or replace function app_private.get_quran_progress(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return pg_catalog.jsonb_build_object('progress', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('surah', q.surah_number, 'ayah', q.last_verse,
      'updated_at', app_private.iso(q.updated_at)) order by q.surah_number)
    from public.quran_reading_progress q where q.user_id = p_uid), '[]'::jsonb));
end $$;

create or replace function app_private.put_quran_progress(p_uid uuid, p_now timestamptz, p_surah int, p_ayah int) returns jsonb
language plpgsql set search_path = '' as $$
declare v_count int;
begin
  perform app_private.require_active(p_uid, p_now);
  if p_surah is null or p_surah not between 1 and 114 then perform app_private.fail('NOT_FOUND', 'surah'); end if;
  if p_ayah is not null and p_ayah < 1 then perform app_private.fail('VALIDATION_ERROR', 'ayah'); end if;
  -- Once the Qur'an dataset is imported, a position past the last verse is refused.
  select s.verse_count into v_count from public.quran_surahs s where s.surah_number = p_surah;
  if p_ayah is not null and v_count is not null and p_ayah > v_count then perform app_private.fail('VALIDATION_ERROR', 'ayah'); end if;
  insert into public.quran_reading_progress (user_id, surah_number, last_verse, updated_at)
  values (p_uid, p_surah, p_ayah, p_now)
  on conflict (user_id, surah_number) do update set last_verse = excluded.last_verse, updated_at = excluded.updated_at;
  return pg_catalog.jsonb_build_object('surah', p_surah, 'ayah', p_ayah, 'updated_at', app_private.iso(p_now));
end $$;

-- ---------- excuse (berhalangan): one date or a range, no reason stored (PRD §10.6) ----------
create or replace function app_private.excused_dates_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('excused_dates', coalesce(
    (select pg_catalog.jsonb_agg(x.excused_date order by x.excused_date) from public.session_excuses x where x.user_id = p_uid), '[]'::jsonb))
$$;

create or replace function app_private.add_excuse(p_uid uuid, p_now timestamptz, p_from date, p_to date) returns jsonb
language plpgsql set search_path = '' as $$
declare v_to date := coalesce(p_to, p_from); v_max int; s record;
begin
  perform app_private.require_active(p_uid, p_now);
  if p_from is null then perform app_private.fail('VALIDATION_ERROR', 'invalid_date'); end if;
  if v_to < p_from then perform app_private.fail('VALIDATION_ERROR', 'invalid_range'); end if;
  v_max := app_private.int_setting('excuse_max_days_per_action', 15);
  if (v_to - p_from + 1) > v_max then perform app_private.fail('VALIDATION_ERROR', 'range_too_long'); end if;
  insert into public.session_excuses (user_id, excused_date, created_at)
  select p_uid, d::date, p_now from pg_catalog.generate_series(p_from::timestamp, v_to::timestamp, interval '1 day') g(d)
  on conflict do nothing;
  -- Sessions that already exist take the new status now, and a correction after cutoff leaves an audit row.
  for s in select n.id, n.fajr_local_date, n.timezone from public.night_sessions n
           where n.user_id = p_uid and n.fajr_local_date between p_from and v_to loop
    perform app_private.refresh_session(s.id, p_now);
    if p_now >= app_private.session_cutoff(s.fajr_local_date, s.timezone) then
      insert into public.session_audit_logs (session_id, actor_id, operation_type, previous_value, new_value, occurred_at)
      values (s.id, p_uid, 'excuse_added', null, pg_catalog.jsonb_build_object('excused', true), p_now);
    end if;
  end loop;
  return app_private.excused_dates_json(p_uid);
end $$;

-- Only inside the correction window of that session (PRD §10.6).
create or replace function app_private.cancel_excuse(p_uid uuid, p_now timestamptz, p_date date) returns jsonb
language plpgsql set search_path = '' as $$
declare n public.night_sessions; v_tz text;
begin
  perform app_private.require_active(p_uid, p_now);
  if not exists (select 1 from public.session_excuses x where x.user_id = p_uid and x.excused_date = p_date) then
    perform app_private.fail('NOT_FOUND');
  end if;
  select * into n from public.night_sessions where user_id = p_uid and fajr_local_date = p_date;
  v_tz := coalesce(n.timezone, app_private.user_timezone(p_uid));
  if v_tz is not null and p_now > app_private.session_cutoff(p_date, v_tz) + app_private.correction_window() then
    perform app_private.fail('SESSION_LOCKED');
  end if;
  delete from public.session_excuses where user_id = p_uid and excused_date = p_date;
  if n.id is not null then
    perform app_private.refresh_session(n.id, p_now);
    if p_now >= app_private.session_cutoff(p_date, n.timezone) then
      insert into public.session_audit_logs (session_id, actor_id, operation_type, previous_value, new_value, occurred_at)
      values (n.id, p_uid, 'excuse_cancelled', pg_catalog.jsonb_build_object('excused', true), null, p_now);
    end if;
  end if;
  return app_private.excused_dates_json(p_uid);
end $$;

-- ---------- public wrappers (signed-in user, server clock) ----------
create or replace function public.get_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_access(auth.uid(), app_private.server_now())
$$;
create or replace function public.get_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_profile(auth.uid(), app_private.server_now())
$$;
create or replace function public.update_profile(p_display_name text) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.update_profile(auth.uid(), app_private.server_now(), p_display_name)
$$;
create or replace function public.update_preferences(p_theme text, p_quran int, p_dhikr int) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.update_preferences(auth.uid(), app_private.server_now(), p_theme, p_quran, p_dhikr)
$$;
create or replace function public.set_location(
  p_mode text, p_region_id uuid, p_timezone text, p_fajr text, p_maghrib text
) returns void
language sql security definer set search_path = '' as $$
  select app_private.set_location(auth.uid(), app_private.server_now(), p_mode, p_region_id, p_timezone, p_fajr, p_maghrib)
$$;
create or replace function public.complete_onboarding() returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.complete_onboarding(auth.uid(), app_private.server_now())
$$;
create or replace function public.get_notification_prefs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_notification_prefs(auth.uid(), app_private.server_now())
$$;
create or replace function public.put_notification_prefs(p jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.put_notification_prefs(auth.uid(), app_private.server_now(), p)
$$;
create or replace function public.get_quran_progress() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_quran_progress(auth.uid(), app_private.server_now())
$$;
create or replace function public.put_quran_progress(p_surah int, p_ayah int) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.put_quran_progress(auth.uid(), app_private.server_now(), p_surah, p_ayah)
$$;
create or replace function public.add_excuse(p_from date, p_to date) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.add_excuse(auth.uid(), app_private.server_now(), p_from, p_to)
$$;
create or replace function public.cancel_excuse(p_date date) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.cancel_excuse(auth.uid(), app_private.server_now(), p_date)
$$;

grant execute on function public.get_access() to authenticated;
grant execute on function public.get_profile() to authenticated;
grant execute on function public.update_profile(text) to authenticated;
grant execute on function public.update_preferences(text, int, int) to authenticated;
grant execute on function public.set_location(text, uuid, text, text, text) to authenticated;
grant execute on function public.complete_onboarding() to authenticated;
grant execute on function public.get_notification_prefs() to authenticated;
grant execute on function public.put_notification_prefs(jsonb) to authenticated;
grant execute on function public.get_quran_progress() to authenticated;
grant execute on function public.put_quran_progress(int, int) to authenticated;
grant execute on function public.add_excuse(date, date) to authenticated;
grant execute on function public.cancel_excuse(date) to authenticated;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;
