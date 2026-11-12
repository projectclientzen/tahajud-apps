-- Business rules in SQL. Mirrors src/domain (S2): session key and cutoff, session status, level progression,
-- idempotent counter operations. Rules live in app_private with an explicit `p_now`, so tests control time.
-- The public.* functions are thin wrappers that pass auth.uid() and the server clock, nothing the client can set.

-- ---------- helpers ----------
create or replace function app_private.fail(p_code text, p_detail text default null) returns void
language plpgsql set search_path = '' as $$
begin
  -- One stable error code per failure, in the message. The API layer maps it to {error: {code}}.
  -- RAISE refuses a NULL option, so the detail is only passed when there is one.
  if p_detail is null then
    raise exception using errcode = 'P0001', message = p_code;
  end if;
  raise exception using errcode = 'P0001', message = p_code, detail = p_detail;
end $$;

create or replace function app_private.setting(p_key text) returns jsonb
language sql stable set search_path = '' as $$
  select s.value from public.app_settings s where s.key = p_key
$$;

-- Provisional: 12:00 local (PRD §11.1). Falls back to the PRD default if the setting is missing.
create or replace function app_private.cutoff_time() returns time
language sql stable set search_path = '' as $$
  select coalesce((app_private.setting('cutoff_local_time') #>> '{}')::time, time '12:00')
$$;

-- Provisional: 48 hours after cutoff (PRD §11.2).
create or replace function app_private.correction_window() returns interval
language sql stable set search_path = '' as $$
  select pg_catalog.make_interval(hours => coalesce((app_private.setting('correction_window_hours') #>> '{}')::int, 48))
$$;

create or replace function app_private.session_cutoff(p_date date, p_tz text) returns timestamptz
language sql stable set search_path = '' as $$
  select ((p_date + app_private.cutoff_time())::timestamp) at time zone p_tz
$$;

-- activeSessionKey (src/domain/session/keys.ts): before today's cutoff it is today, after it tomorrow.
create or replace function app_private.active_session_key(p_now timestamptz, p_tz text) returns date
language sql stable set search_path = '' as $$
  select case when p_now < app_private.session_cutoff(l.d, p_tz) then l.d else l.d + 1 end
  from (select (p_now at time zone p_tz)::date as d) l
$$;

create or replace function app_private.user_timezone(p_uid uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce(r.timezone, p.manual_schedule ->> 'timezone')
  from public.profiles p left join public.regions r on r.id = p.region_id
  where p.user_id = p_uid
$$;

create or replace function app_private.has_active_entitlement(p_uid uuid, p_now timestamptz default pg_catalog.now()) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.access_entitlements e
    where e.user_id = p_uid and e.status = 'active'
      and e.starts_at <= p_now and (e.expires_at is null or e.expires_at > p_now)
  )
$$;

create or replace function app_private.require_active(p_uid uuid, p_now timestamptz) returns void
language plpgsql set search_path = '' as $$
begin
  if p_uid is null then perform app_private.fail('UNAUTHENTICATED'); end if;
  if not app_private.has_active_entitlement(p_uid, p_now) then perform app_private.fail('ENTITLEMENT_INACTIVE'); end if;
end $$;

-- ---------- session status (computeSessionStatus) ----------
create or replace function app_private.compute_session_status(p_session_id uuid, p_now timestamptz) returns text
language plpgsql stable set search_path = '' as $$
declare
  s public.night_sessions;
  v_required int; v_required_done int; v_progress int; v_closed boolean;
begin
  select * into s from public.night_sessions where id = p_session_id;
  if s.excused_at is not null then return 'excused'; end if;
  select count(*) filter (where required_for_completion),
         count(*) filter (where required_for_completion and status = 'done'),
         count(*) filter (where status <> 'pending')
    into v_required, v_required_done, v_progress
  from public.session_activities where session_id = p_session_id;
  -- Completed the moment every required activity is done. No "finish" button decides it (BUG-06).
  if v_required > 0 and v_required = v_required_done then return 'completed'; end if;
  v_closed := p_now >= app_private.session_cutoff(s.fajr_local_date, s.timezone);
  if v_progress > 0 then return case when v_closed then 'partial' else 'in_progress' end; end if;
  return case when v_closed then 'missed' else 'scheduled' end;
end $$;

create or replace function app_private.refresh_session(p_session_id uuid, p_now timestamptz) returns text
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  v_status := app_private.compute_session_status(p_session_id, p_now);
  update public.night_sessions s set
    status = v_status,
    started_at = coalesce(s.started_at, case when v_status in ('in_progress', 'completed', 'partial') then p_now end),
    completed_at = case when v_status = 'completed' then coalesce(s.completed_at, p_now) end,
    closed_at = case when p_now >= app_private.session_cutoff(s.fajr_local_date, s.timezone) then coalesce(s.closed_at, p_now) end,
    version = s.version + case when s.status is distinct from v_status then 1 else 0 end
  where s.id = p_session_id;
  return v_status;
end $$;

-- ---------- level progression (checkUnlock, levelForSession) ----------
create or replace function app_private.level_for_session(p_uid uuid, p_key date) returns int
language sql stable set search_path = '' as $$
  select coalesce(
    (select case when st.level_3_effective_from <= p_key then 3 when st.level_2_effective_from <= p_key then 2 else 1 end
     from public.user_level_state st where st.user_id = p_uid), 1)
$$;

-- Levels only ever open. A correction that lowers the completed count never locks one again (SESSION-05).
-- A new level applies from the session after the running one (LEVEL-04).
create or replace function app_private.recompute_progression(p_uid uuid, p_now timestamptz, p_active_key date) returns void
language plpgsql set search_path = '' as $$
declare
  st public.user_level_state;
  lvl int; v_req int; v_key date; v_base date; v_done int;
begin
  insert into public.user_level_state (user_id, level_1_unlocked_at) values (p_uid, p_now) on conflict (user_id) do nothing;
  for lvl in 1..2 loop
    select * into st from public.user_level_state where user_id = p_uid for update;
    if lvl = 2 and st.level_2_unlocked_at is null then exit; end if;
    if (lvl = 1 and st.level_2_unlocked_at is not null) or (lvl = 2 and st.level_3_unlocked_at is not null) then continue; end if;
    select l.required_successful_nights into v_req from public.levels l where l.level_number = lvl;
    select x.fajr_local_date into v_key from (
      select n.fajr_local_date, row_number() over (order by n.fajr_local_date) as rn
      from public.night_sessions n where n.user_id = p_uid and n.level_number = lvl and n.status = 'completed'
    ) x where x.rn = v_req;
    if v_key is null then continue; end if;
    v_base := greatest(v_key, p_active_key);
    if lvl = 1 then
      update public.user_level_state set level_2_unlocked_at = p_now, level_2_effective_from = v_base + 1 where user_id = p_uid;
    else
      update public.user_level_state set level_3_unlocked_at = p_now, level_3_effective_from = v_base + 1 where user_id = p_uid;
    end if;
  end loop;

  select count(*) into v_done from public.night_sessions n where n.user_id = p_uid and n.level_number = 3 and n.status = 'completed';
  select l.required_successful_nights into v_req from public.levels l where l.level_number = 3;
  update public.user_level_state set
    journey_completed_at = case when v_done >= v_req then coalesce(journey_completed_at, p_now) else journey_completed_at end,
    current_level = app_private.level_for_session(p_uid, p_active_key)
  where user_id = p_uid;
end $$;

-- ---------- ensure_active_session ----------
create or replace function app_private.ensure_active_session(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare
  p public.profiles; sess public.night_sessions;
  tz text; v_key date; lvl int; ver int; created boolean := false;
begin
  perform app_private.require_active(p_uid, p_now);
  select * into p from public.profiles where user_id = p_uid;
  tz := app_private.user_timezone(p_uid);
  if tz is null then perform app_private.fail('LOCATION_REQUIRED'); end if;
  v_key := app_private.active_session_key(p_now, tz);
  perform app_private.recompute_progression(p_uid, p_now, v_key);

  select * into sess from public.night_sessions where user_id = p_uid and fajr_local_date = v_key;
  if not found then
    lvl := app_private.level_for_session(p_uid, v_key);
    select coalesce(max(c.config_version), 1) into ver
    from public.level_activity_config c join public.levels l on l.id = c.level_id
    where l.level_number = lvl and c.is_active;

    insert into public.night_sessions (user_id, fajr_local_date, timezone, region_id, schedule_source, level_number, level_config_version)
    values (p_uid, v_key, tz, p.region_id, case when p.manual_schedule is not null then 'manual' else 'provider' end, lvl, ver)
    on conflict (user_id, fajr_local_date) do nothing
    returning * into sess;

    if found then
      created := true;
      -- Freeze today's requirements into the session (PRD §11.5, §22.3).
      insert into public.session_activities
        (session_id, user_id, activity_definition_id, activity_config_snapshot, phase, target_count, required_for_completion)
      select sess.id, p_uid, c.activity_definition_id,
             pg_catalog.jsonb_build_object(
               'activity_key', d.activity_key,
               'activity_type', d.activity_type,
               'kind', case when d.activity_type = 'dhikr' then 'counter' else 'checklist' end,
               'title', coalesce(c.title_override, d.title),
               'counter_unit', d.counter_unit,
               'sequence_order', c.sequence_order,
               'config_version', c.config_version),
             c.phase, c.target_count, c.required_for_completion
      from public.level_activity_config c
      join public.levels l on l.id = c.level_id
      join public.activity_definitions d on d.id = c.activity_definition_id
      where l.level_number = lvl and c.is_active;
    else
      -- Another request created it first.
      select * into sess from public.night_sessions where user_id = p_uid and fajr_local_date = v_key;
    end if;
  end if;

  perform app_private.refresh_session(sess.id, p_now);
  select * into sess from public.night_sessions where id = sess.id;
  return pg_catalog.jsonb_build_object(
    'session_id', sess.id, 'session_key', sess.fajr_local_date, 'level_number', sess.level_number,
    'timezone', sess.timezone, 'status', sess.status, 'created', created);
end $$;

-- ---------- set_checklist ----------
create or replace function app_private.set_checklist(
  p_uid uuid, p_now timestamptz, p_activity_id uuid, p_checked boolean, p_version int
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  a public.session_activities; s public.night_sessions;
  v_cutoff timestamptz; v_status text; v_tz text; v_key date;
begin
  perform app_private.require_active(p_uid, p_now);
  select * into a from public.session_activities where id = p_activity_id and user_id = p_uid for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  select * into s from public.night_sessions where id = a.session_id;
  if a.activity_config_snapshot ->> 'kind' <> 'checklist' then perform app_private.fail('VALIDATION_ERROR', 'counter activity'); end if;
  if p_now > app_private.session_cutoff(s.fajr_local_date, s.timezone) + app_private.correction_window() then
    perform app_private.fail('SESSION_LOCKED');
  end if;
  if a.version <> p_version then
    -- The server value wins. The client applies its tick again if it still changes something (PRD §21.3).
    perform app_private.fail('VERSION_CONFLICT',
      pg_catalog.jsonb_build_object('checked', a.status = 'done', 'version', a.version)::text);
  end if;

  update public.session_activities set
    status = case when p_checked then 'done' else 'pending' end,
    completed_at = case when p_checked then p_now end,
    version = a.version + 1
  where id = a.id;

  v_cutoff := app_private.session_cutoff(s.fajr_local_date, s.timezone);
  if p_now >= v_cutoff then
    insert into public.session_audit_logs (session_id, actor_id, operation_type, previous_value, new_value, occurred_at)
    values (s.id, p_uid, 'checklist_set',
            pg_catalog.jsonb_build_object('activity_id', a.id, 'checked', a.status = 'done'),
            pg_catalog.jsonb_build_object('activity_id', a.id, 'checked', p_checked), p_now);
  end if;

  v_status := app_private.refresh_session(s.id, p_now);
  v_tz := coalesce(app_private.user_timezone(p_uid), s.timezone);
  v_key := app_private.active_session_key(p_now, v_tz);
  perform app_private.recompute_progression(p_uid, p_now, v_key);
  return pg_catalog.jsonb_build_object(
    'session_activity_id', a.id, 'checked', p_checked, 'version', a.version + 1, 'session_status', v_status);
end $$;

-- ---------- apply_counter_operation (applyOperation in src/domain/dhikr/server.ts) ----------
create or replace function app_private.counter_result(
  p_op text, p_status text, p_count int, p_target int, p_now timestamptz, p_error text default null
) returns jsonb
language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'operation_id', p_op,
    'status', p_status,
    'authoritative_count', p_count,
    'target', p_target,
    'completed', p_target > 0 and p_count >= p_target,
    'updated_at', pg_catalog.to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'error_code', p_error))
$$;

create or replace function app_private.apply_counter_operation(
  p_uid uuid, p_now timestamptz, p_activity_id uuid, p_op_id text, p_op_type text, p_delta int, p_client_recorded_at timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  a public.session_activities; s public.night_sessions;
  v_count int; v_target int; v_new int; v_recorded timestamptz; v_cutoff timestamptz;
  v_tz text; v_key date; v_found boolean;
begin
  perform app_private.require_active(p_uid, p_now);
  if p_op_id is null or p_op_id = '' or p_op_type not in ('delta', 'set_zero') then
    perform app_private.fail('VALIDATION_ERROR', 'bad operation');
  end if;

  -- Lock the activity first, so two requests for it (or the same operation twice) run one after the other.
  select * into a from public.session_activities where id = p_activity_id and user_id = p_uid for update;
  v_found := found;
  v_count := coalesce(a.actual_count, 0);
  v_target := coalesce(a.target_count, 0);

  if exists (select 1 from public.counter_operations o where o.user_id = p_uid and o.client_operation_id = p_op_id) then
    -- Same result as before, nothing added. Reports today's count so the client catches up.
    return app_private.counter_result(p_op_id, 'duplicate', v_count, v_target, p_now);
  end if;
  if not v_found or a.activity_config_snapshot ->> 'kind' <> 'counter' then
    return app_private.counter_result(p_op_id, 'rejected', 0, 0, p_now, 'ACTIVITY_NOT_FOUND');
  end if;

  select * into s from public.night_sessions where id = a.session_id;
  v_cutoff := app_private.session_cutoff(s.fajr_local_date, s.timezone);
  if p_now > v_cutoff + app_private.correction_window() then
    return app_private.counter_result(p_op_id, 'rejected', v_count, v_target, p_now, 'SESSION_LOCKED');
  end if;
  if p_op_type = 'delta' and (p_delta is null or p_delta = 0 or abs(p_delta) > 1000) then
    return app_private.counter_result(p_op_id, 'rejected', v_count, v_target, p_now, 'INVALID_DELTA');
  end if;

  -- Never below zero. set_zero is a correction event that keeps history; later deltas still apply (BUG-10).
  v_new := case when p_op_type = 'set_zero' then 0 else greatest(0, v_count + p_delta) end;
  -- A client clock more than 5 minutes ahead is replaced by server time (BUG-09).
  v_recorded := case when p_client_recorded_at is null or p_client_recorded_at > p_now + interval '5 minutes'
                     then p_now else p_client_recorded_at end;

  insert into public.counter_operations
    (user_id, client_operation_id, session_activity_id, op_type, delta, resulting_count, client_recorded_at, server_applied_at)
  values (p_uid, p_op_id, a.id, p_op_type, case when p_op_type = 'delta' then p_delta else 0 end, v_new, v_recorded, p_now);

  update public.session_activities set
    actual_count = v_new,
    status = case when v_new = 0 then 'pending' when v_new >= v_target and v_target > 0 then 'done' else 'in_progress' end,
    completed_at = case when v_new >= v_target and v_target > 0 then coalesce(completed_at, p_now) end,
    version = a.version + 1
  where id = a.id;

  if p_op_type = 'set_zero' or p_now >= v_cutoff then
    insert into public.session_audit_logs (session_id, actor_id, operation_type, previous_value, new_value, occurred_at)
    values (s.id, p_uid, case when p_op_type = 'set_zero' then 'counter_set_zero' else 'counter_correction' end,
            pg_catalog.jsonb_build_object('activity_id', a.id, 'count', v_count),
            pg_catalog.jsonb_build_object('activity_id', a.id, 'count', v_new), p_now);
  end if;

  perform app_private.refresh_session(s.id, p_now);
  v_tz := coalesce(app_private.user_timezone(p_uid), s.timezone);
  v_key := app_private.active_session_key(p_now, v_tz);
  perform app_private.recompute_progression(p_uid, p_now, v_key);
  return app_private.counter_result(p_op_id, 'accepted', v_new, v_target, p_now);
end $$;

-- ---------- public RPC wrappers ----------
create or replace function public.has_active_entitlement(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  -- A user can only ask about themselves. Backend code with the service role reads access_entitlements directly.
  select auth.uid() is not null and p_uid = auth.uid() and app_private.has_active_entitlement(p_uid, pg_catalog.now())
$$;

create or replace function public.ensure_active_session() returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.ensure_active_session(auth.uid(), pg_catalog.now())
$$;

create or replace function public.set_checklist(p_session_activity_id uuid, p_checked boolean, p_version int) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.set_checklist(auth.uid(), pg_catalog.now(), p_session_activity_id, p_checked, p_version)
$$;

create or replace function public.apply_counter_operation(
  p_session_activity_id uuid, p_client_operation_id text, p_op_type text, p_delta int, p_client_recorded_at timestamptz
) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.apply_counter_operation(
    auth.uid(), pg_catalog.now(), p_session_activity_id, p_client_operation_id, p_op_type, p_delta, p_client_recorded_at)
$$;
