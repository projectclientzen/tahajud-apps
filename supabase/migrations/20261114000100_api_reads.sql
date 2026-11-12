-- T3b: read functions for /api/v1 (PRD v1.2 §19.4, §19.5). Safe to run twice.
-- Rules mirror src/domain (calendar, progression, reporting). Every public.* function is a thin wrapper that passes
-- auth.uid() and the server clock. Business logic lives in app_private.*(p_uid, p_now, ...), so tests control time.

-- ---------- schema additions ----------
-- Guidance text is separate from `description` (which also holds the owner's note). The seed fills it.
alter table public.activity_definitions add column if not exists guidance text;

-- One row per excused date, no reason, no category (PRD §10.6, §24.4). Backend only: no grants, and no admin function
-- may read it per user (PRD §18.2).
create table if not exists public.session_excuses (
  user_id uuid not null references auth.users (id) on delete cascade,
  excused_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, excused_date)
);
alter table public.session_excuses enable row level security;
revoke all on public.session_excuses from anon, authenticated;

-- ---------- helpers ----------
create or replace function app_private.iso(p_ts timestamptz) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create or replace function app_private.display_status(p_state text) returns text
language sql immutable set search_path = '' as $$
  select case when p_state in ('scheduled', 'in_progress') then 'upcoming' else p_state end
$$;

-- Excused wins over everything, also for sessions that already have progress (PRD §10.6).
create or replace function app_private.compute_session_status(p_session_id uuid, p_now timestamptz) returns text
language plpgsql stable set search_path = '' as $$
declare
  s public.night_sessions;
  v_required int; v_required_done int; v_progress int; v_closed boolean;
begin
  select * into s from public.night_sessions where id = p_session_id;
  if s.excused_at is not null or exists (
    select 1 from public.session_excuses x where x.user_id = s.user_id and x.excused_date = s.fajr_local_date
  ) then return 'excused'; end if;
  select count(*) filter (where required_for_completion),
         count(*) filter (where required_for_completion and status = 'done'),
         count(*) filter (where status <> 'pending')
    into v_required, v_required_done, v_progress
  from public.session_activities where session_id = p_session_id;
  if v_required > 0 and v_required = v_required_done then return 'completed'; end if;
  v_closed := p_now >= app_private.session_cutoff(s.fajr_local_date, s.timezone);
  if v_progress > 0 then return case when v_closed then 'partial' else 'in_progress' end; end if;
  return case when v_closed then 'missed' else 'scheduled' end;
end $$;

-- The session key a user is on right now, or null while there is no location yet.
create or replace function app_private.user_active_key(p_uid uuid, p_now timestamptz) returns date
language sql stable set search_path = '' as $$
  select case when app_private.user_timezone(p_uid) is null then null
              else app_private.active_session_key(p_now, app_private.user_timezone(p_uid)) end
$$;

-- ---------- session as the API shows it (NightSession) ----------
create or replace function app_private.session_json(p_uid uuid, p_now timestamptz, p_session_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  s public.night_sessions; v_state text; v_cutoff timestamptz; v_deadline timestamptz; v_acts jsonb;
begin
  select * into s from public.night_sessions where id = p_session_id and user_id = p_uid;
  -- Another user's session reads as missing, never as forbidden (T3a-5).
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  v_state := app_private.compute_session_status(s.id, p_now);
  v_cutoff := app_private.session_cutoff(s.fajr_local_date, s.timezone);
  v_deadline := v_cutoff + app_private.correction_window();

  select coalesce(pg_catalog.jsonb_agg(x.j order by x.ord, x.seq), '[]'::jsonb) into v_acts
  from (
    select
      case a.phase when 'night' then 1 when 'fajr' then 2 else 3 end as ord,
      coalesce((a.activity_config_snapshot ->> 'sequence_order')::int, 0) as seq,
      pg_catalog.jsonb_build_object(
        'id', a.id,
        'key', a.activity_config_snapshot ->> 'activity_key',
        'phase', a.phase,
        'type', a.activity_config_snapshot ->> 'activity_type',
        'kind', a.activity_config_snapshot ->> 'kind',
        'title', a.activity_config_snapshot ->> 'title',
        'target', a.target_count,
        'unit', a.activity_config_snapshot ->> 'counter_unit',
        'required', a.required_for_completion,
        'guidance', d.guidance,
        -- Owner text, passed through as stored. Nothing here edits it.
        'arabic_text', d.arabic_text,
        'dhikr_review_status', case when d.activity_type = 'dhikr' then d.review_status end,
        'count', a.actual_count,
        'checked', a.activity_config_snapshot ->> 'kind' = 'checklist' and a.status = 'done',
        'version', a.version,
        'completed', case when a.activity_config_snapshot ->> 'kind' = 'checklist' then a.status = 'done'
                          when a.target_count is null then a.actual_count > 0
                          else a.actual_count >= a.target_count end
      ) as j
    from public.session_activities a
    join public.activity_definitions d on d.id = a.activity_definition_id
    where a.session_id = s.id
  ) x;

  return pg_catalog.jsonb_build_object(
    'id', s.id,
    'session_key', s.fajr_local_date,
    'status', app_private.display_status(v_state),
    'state', v_state,
    'level', s.level_number,
    'timezone', s.timezone,
    'region_id', s.region_id,
    'content_version', 'cfg-' || s.level_config_version,
    'created_at', app_private.iso(s.created_at),
    'cutoff_at', app_private.iso(v_cutoff),
    'correction_deadline_at', app_private.iso(v_deadline),
    'correction_window_open', p_now <= v_deadline,
    'activities', v_acts);
end $$;

-- Null until the first interaction creates the row.
create or replace function app_private.active_session_json(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_key date; v_id uuid;
begin
  perform app_private.require_active(p_uid, p_now);
  v_key := app_private.user_active_key(p_uid, p_now);
  if v_key is null then return null; end if;
  select id into v_id from public.night_sessions where user_id = p_uid and fajr_local_date = v_key;
  if v_id is null then return null; end if;
  return app_private.session_json(p_uid, p_now, v_id);
end $$;

create or replace function app_private.get_session_json(p_uid uuid, p_now timestamptz, p_session_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return app_private.session_json(p_uid, p_now, p_session_id);
end $$;

-- ---------- calendar (buildCalendar). Missed is derived, no row needed (PRD §10.4) ----------
create or replace function app_private.session_rollup(p_uid uuid)
returns table (session_id uuid, session_key date, level_number int, excused boolean, req_total int, req_done int, progress int)
language sql stable set search_path = '' as $$
  select s.id, s.fajr_local_date, s.level_number::int,
         s.excused_at is not null,
         (count(a.id) filter (where a.required_for_completion))::int,
         (count(a.id) filter (where a.required_for_completion and a.status = 'done'))::int,
         (count(a.id) filter (where a.status <> 'pending'))::int
  from public.night_sessions s left join public.session_activities a on a.session_id = s.id
  where s.user_id = p_uid
  group by s.id
$$;

create or replace function app_private.calendar_days(p_uid uuid, p_now timestamptz, p_from date default null, p_to date default null)
returns table (day date, status text, level int, has_progress boolean)
language plpgsql stable set search_path = '' as $$
declare v_start date; v_active date; v_from date; v_to date;
begin
  select p.program_start_date into v_start from public.profiles p where p.user_id = p_uid;
  v_active := app_private.user_active_key(p_uid, p_now);
  if v_start is null or v_active is null or v_start > v_active then return; end if;
  v_from := greatest(v_start, coalesce(p_from, v_start));
  v_to := least(v_active, coalesce(p_to, v_active));
  if v_from > v_to then return; end if;
  return query
  select g.d::date,
         case
           when r.excused or x.excused_date is not null then 'excused'
           when coalesce(r.req_total, 0) > 0 and r.req_done = r.req_total then 'completed'
           when g.d::date < v_active then case when coalesce(r.progress, 0) > 0 then 'partial' else 'missed' end
           else 'upcoming'
         end,
         r.level_number,
         coalesce(r.progress, 0) > 0
  from pg_catalog.generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') as g(d)
  left join app_private.session_rollup(p_uid) r on r.session_key = g.d::date
  left join public.session_excuses x on x.user_id = p_uid and x.excused_date = g.d::date
  order by g.d;
end $$;

create or replace function app_private.calendar_json(p_uid uuid, p_now timestamptz, p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return pg_catalog.jsonb_build_object('days', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'date', c.day, 'status', c.status, 'level', c.level, 'has_progress', c.has_progress) order by c.day)
    from app_private.calendar_days(p_uid, p_now, p_from, p_to) c), '[]'::jsonb));
end $$;

create or replace function app_private.status_counts_json(p_uid uuid, p_now timestamptz, p_from date, p_to date) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'completed', count(*) filter (where c.status = 'completed'),
    'partial', count(*) filter (where c.status = 'partial'),
    'missed', count(*) filter (where c.status = 'missed'),
    'excused', count(*) filter (where c.status = 'excused'),
    'upcoming', count(*) filter (where c.status = 'upcoming'))
  from app_private.calendar_days(p_uid, p_now, p_from, p_to) c
$$;

-- completed / (completed + partial + missed) x 100, two decimals. Denominator 0 gives null (PRD §22.2).
create or replace function app_private.completion_rate(p_counts jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case when d = 0 then null else pg_catalog.round(c * 100.0 / d, 2) end
  from (select (p_counts ->> 'completed')::numeric as c,
               ((p_counts ->> 'completed')::numeric + (p_counts ->> 'partial')::numeric + (p_counts ->> 'missed')::numeric) as d) t
$$;

-- ---------- per activity statistics (activityStats) ----------
create or replace function app_private.activity_stats_json(p_uid uuid, p_from date, p_to date) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', t.id, 'key', t.k, 'phase', t.phase, 'sessions', t.n, 'with_progress', t.wp,
    'times_completed', t.tc, 'total_count', t.tot) order by t.id collate "C"), '[]'::jsonb)
  from (
    select a.phase || ':' || (a.activity_config_snapshot ->> 'activity_key') as id,
           a.activity_config_snapshot ->> 'activity_key' as k,
           a.phase,
           count(*)::int as n,
           (count(*) filter (where a.status <> 'pending'))::int as wp,
           (count(*) filter (where a.status = 'done'))::int as tc,
           coalesce(sum(a.actual_count) filter (where a.activity_config_snapshot ->> 'kind' = 'counter'), 0)::int as tot
    from public.session_activities a join public.night_sessions s on s.id = a.session_id
    where s.user_id = p_uid
      and (p_from is null or s.fajr_local_date >= p_from)
      and (p_to is null or s.fajr_local_date <= p_to)
    group by 1, 2, 3
  ) t
$$;

create or replace function app_private.get_activity_stats(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return pg_catalog.jsonb_build_object('activity_statistics', app_private.activity_stats_json(p_uid, null, null));
end $$;

-- ---------- level progress (computeLevelProgress) ----------
create or replace function app_private.level_progress_json(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  st public.user_level_state; v_active date; v_start date; v_cur int; v_l3_done int; v_l3_req int;
begin
  select * into st from public.user_level_state where user_id = p_uid;
  select p.program_start_date into v_start from public.profiles p where p.user_id = p_uid;
  v_active := app_private.user_active_key(p_uid, p_now);
  v_cur := case when v_active is null then 1 else app_private.level_for_session(p_uid, v_active) end;
  select count(*) into v_l3_done from public.night_sessions n where n.user_id = p_uid and n.level_number = 3 and n.status = 'completed';
  select l.required_successful_nights into v_l3_req from public.levels l where l.level_number = 3;
  return pg_catalog.jsonb_build_object(
    'current_level', v_cur,
    'levels', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'level', l.level_number,
        'completed', c.n,
        'required', l.required_successful_nights,
        'ratio', least(1.0::float8, c.n::float8 / l.required_successful_nights),
        'unlocked', case l.level_number when 1 then true when 2 then st.level_2_effective_from is not null
                    else st.level_3_effective_from is not null end,
        'is_current', l.level_number = v_cur,
        'effective_from_session_key', case l.level_number when 1 then v_start when 2 then st.level_2_effective_from
                                      else st.level_3_effective_from end
      ) order by l.level_number)
      from public.levels l
      cross join lateral (
        select count(*)::int as n from public.night_sessions n
        where n.user_id = p_uid and n.level_number = l.level_number and n.status = 'completed'
      ) c),
    'journey_completed', v_l3_done >= v_l3_req,
    -- Required nights are still provisional until the owner approves them (PRD §30.2).
    'provisional', true);
end $$;

create or replace function app_private.get_level_progress(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return app_private.level_progress_json(p_uid, p_now);
end $$;

create or replace function app_private.get_current_level(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_active date; v_lvl int; st public.user_level_state; v_start date;
begin
  perform app_private.require_active(p_uid, p_now);
  v_active := app_private.user_active_key(p_uid, p_now);
  v_lvl := case when v_active is null then 1 else app_private.level_for_session(p_uid, v_active) end;
  select * into st from public.user_level_state where user_id = p_uid;
  select p.program_start_date into v_start from public.profiles p where p.user_id = p_uid;
  return pg_catalog.jsonb_build_object(
    'level', v_lvl,
    'effective_from_session_key', case v_lvl when 1 then v_start when 2 then st.level_2_effective_from else st.level_3_effective_from end);
end $$;

-- ---------- summary. Opening it never changes status (PRD §19.4) ----------
create or replace function app_private.get_session_summary(p_uid uuid, p_now timestamptz, p_session_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  s public.night_sessions; st public.user_level_state; v_active date; v_done int; v_req int; v_eff date; v_cur int;
begin
  perform app_private.require_active(p_uid, p_now);
  select * into s from public.night_sessions where id = p_session_id and user_id = p_uid;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  select * into st from public.user_level_state where user_id = p_uid;
  v_active := app_private.user_active_key(p_uid, p_now);
  v_cur := case when v_active is null then s.level_number else app_private.level_for_session(p_uid, v_active) end;
  select count(*)::int into v_done from public.night_sessions n
    where n.user_id = p_uid and n.level_number = s.level_number and n.status = 'completed';
  select l.required_successful_nights into v_req from public.levels l where l.level_number = s.level_number;
  v_eff := case s.level_number when 1 then st.level_2_effective_from when 2 then st.level_3_effective_from else null end;
  return pg_catalog.jsonb_build_object(
    'session_id', s.id,
    'session_status', app_private.display_status(app_private.compute_session_status(s.id, p_now)),
    'successful_nights_at_level', v_done,
    'required_successful_nights', v_req,
    'current_level', v_cur,
    'next_level_unlocked', v_eff is not null,
    'next_level_effective_session_key', v_eff);
end $$;

-- ---------- session history, newest first ----------
create or replace function app_private.session_history_json(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return pg_catalog.jsonb_build_object('sessions', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'session_key', c.day, 'status', c.status, 'level', c.level,
      'required_done', r.req_done, 'required_total', r.req_total) order by c.day desc)
    from app_private.calendar_days(p_uid, p_now) c
    join app_private.session_rollup(p_uid) r on r.session_key = c.day), '[]'::jsonb));
end $$;

-- ---------- report for 7, 30 or 90 closed sessions (selectPeriod, PRD §22.2, BUG-13) ----------
create or replace function app_private.report_json(p_uid uuid, p_now timestamptz, p_period int) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_start date; v_active date; v_last date; v_from date; v_counts jsonb; v_first date; v_final date;
begin
  perform app_private.require_active(p_uid, p_now);
  if p_period not in (7, 30, 90) then perform app_private.fail('VALIDATION_ERROR', 'period'); end if;
  select p.program_start_date into v_start from public.profiles p where p.user_id = p_uid;
  v_active := app_private.user_active_key(p_uid, p_now);
  if v_start is null or v_active is null then
    v_counts := pg_catalog.jsonb_build_object('completed', 0, 'partial', 0, 'missed', 0, 'excused', 0, 'upcoming', 0);
    return pg_catalog.jsonb_build_object('period', p_period, 'from', null, 'to', null, 'status_counts', v_counts,
      'completion_rate', null, 'activity_statistics', '[]'::jsonb);
  end if;
  -- The active session is not closed yet, so it never counts.
  v_last := v_active - 1;
  v_from := greatest(v_start, v_last - (p_period - 1));
  v_counts := app_private.status_counts_json(p_uid, p_now, v_from, v_last);
  select min(c.day), max(c.day) into v_first, v_final from app_private.calendar_days(p_uid, p_now, v_from, v_last) c;
  return pg_catalog.jsonb_build_object(
    'period', p_period,
    'from', v_first,
    'to', v_final,
    'status_counts', v_counts,
    'completion_rate', app_private.completion_rate(v_counts),
    'activity_statistics', app_private.activity_stats_json(p_uid, v_from, v_last));
end $$;

-- ---------- dashboard: everything the database owns. The API adds prayer_time and insight ----------
create or replace function app_private.dashboard_json(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  p public.profiles; v_active date; v_counts jsonb; v_cur jsonb; v_row public.night_sessions; v_lvl int;
  v_state text; v_total int; v_done int; v_excused boolean;
begin
  perform app_private.require_active(p_uid, p_now);
  select * into p from public.profiles where user_id = p_uid;
  v_active := app_private.user_active_key(p_uid, p_now);
  v_counts := app_private.status_counts_json(p_uid, p_now, null, null);

  if v_active is not null then
    select * into v_row from public.night_sessions n where n.user_id = p_uid and n.fajr_local_date = v_active;
    if found then
      v_state := app_private.compute_session_status(v_row.id, p_now);
      select (count(*) filter (where a.required_for_completion and a.status = 'done'))::int,
             (count(*) filter (where a.required_for_completion))::int
        into v_done, v_total from public.session_activities a where a.session_id = v_row.id;
      v_cur := pg_catalog.jsonb_build_object('id', v_row.id, 'session_key', v_active,
        'status', app_private.display_status(v_state), 'state', v_state,
        'required_done', v_done, 'required_total', v_total);
    else
      v_excused := exists (select 1 from public.session_excuses x where x.user_id = p_uid and x.excused_date = v_active);
      v_lvl := app_private.level_for_session(p_uid, v_active);
      select count(*)::int into v_total
      from public.level_activity_config c join public.levels l on l.id = c.level_id
      where l.level_number = v_lvl and c.is_active and c.required_for_completion;
      v_cur := pg_catalog.jsonb_build_object('id', null, 'session_key', v_active,
        'status', case when v_excused then 'excused' else 'upcoming' end,
        'state', case when v_excused then 'excused' else 'scheduled' end,
        'required_done', 0, 'required_total', v_total);
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'is_demo', false,
    'level', case when v_active is null then 1 else app_private.level_for_session(p_uid, v_active) end,
    'level_progress', app_private.level_progress_json(p_uid, p_now),
    'status_counts', v_counts,
    'completion_rate', app_private.completion_rate(v_counts),
    'calendar_days', coalesce((
      select pg_catalog.jsonb_agg(j order by d) from (
        select c.day as d, pg_catalog.jsonb_build_object('date', c.day, 'status', c.status, 'level', c.level,
                                                         'has_progress', c.has_progress) as j
        from app_private.calendar_days(p_uid, p_now) c order by c.day desc limit 30) x), '[]'::jsonb),
    'activity_statistics', app_private.activity_stats_json(p_uid, null, null),
    'current_session', v_cur,
    'setup_cards', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'location', 'done', p.region_id is not null or p.manual_schedule is not null),
      -- Done once a device has an active push subscription. Preferences alone do not deliver anything.
      pg_catalog.jsonb_build_object('key', 'notifications',
        'done', exists (select 1 from public.push_subscriptions s where s.user_id = p_uid and s.is_active))));
end $$;

-- ---------- prayer time row for a date. The API applies the schedule rules (chooseSchedule) ----------
-- Region mode reads the cached provider row. Manual mode builds the instants from the user's own times.
create or replace function app_private.prayer_row_json(p_uid uuid, p_now timestamptz, p_date date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.profiles; r public.regions; t public.prayer_times; m jsonb; v_tz text;
begin
  perform app_private.require_active(p_uid, p_now);
  select * into p from public.profiles where user_id = p_uid;
  if p.manual_schedule is not null and p.region_id is null then
    m := p.manual_schedule;
    v_tz := m ->> 'timezone';
    return pg_catalog.jsonb_build_object(
      'mode', 'manual', 'region_id', null, 'region_name', null, 'timezone', v_tz,
      'fajr_at', app_private.iso(((p_date + (m ->> 'fajr')::time)::timestamp) at time zone v_tz),
      'maghrib_at', case when m ->> 'maghrib' is null then null
                         else app_private.iso(((p_date + (m ->> 'maghrib')::time)::timestamp) at time zone v_tz) end,
      'fetched_at', null, 'valid_until', null);
  end if;
  if p.region_id is null then
    return pg_catalog.jsonb_build_object('mode', 'region', 'region_id', null, 'region_name', null, 'timezone',
      app_private.user_timezone(p_uid), 'fajr_at', null, 'maghrib_at', null, 'fetched_at', null, 'valid_until', null);
  end if;
  select * into r from public.regions where id = p.region_id;
  select * into t from public.prayer_times pt where pt.region_id = p.region_id and pt.local_date = p_date
    order by pt.fetched_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'mode', 'region', 'region_id', r.id, 'region_name', r.city_name, 'timezone', r.timezone,
    'fajr_at', case when t.id is null then null else app_private.iso(t.fajr_at) end,
    'maghrib_at', case when t.id is null or t.maghrib_at is null then null else app_private.iso(t.maghrib_at) end,
    'fetched_at', case when t.id is null then null else app_private.iso(t.fetched_at) end,
    'valid_until', case when t.id is null or t.valid_until is null then null else app_private.iso(t.valid_until) end);
end $$;

create or replace function app_private.list_regions(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'name', r.city_name, 'timezone', r.timezone)
                                order by r.province_name, r.city_name)
    from public.regions r where r.is_supported), '[]'::jsonb);
end $$;

-- ---------- public wrappers ----------
create or replace function public.get_active_session() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.active_session_json(auth.uid(), pg_catalog.now())
$$;
create or replace function public.get_night_session(p_session_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_session_json(auth.uid(), pg_catalog.now(), p_session_id)
$$;
create or replace function public.get_session_summary(p_session_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_session_summary(auth.uid(), pg_catalog.now(), p_session_id)
$$;
create or replace function public.get_current_level() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_current_level(auth.uid(), pg_catalog.now())
$$;
create or replace function public.get_level_progress() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_level_progress(auth.uid(), pg_catalog.now())
$$;
create or replace function public.get_calendar(p_from date default null, p_to date default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.calendar_json(auth.uid(), pg_catalog.now(), p_from, p_to)
$$;
create or replace function public.get_report(p_period int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.report_json(auth.uid(), pg_catalog.now(), p_period)
$$;
create or replace function public.get_activity_stats() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_activity_stats(auth.uid(), pg_catalog.now())
$$;
create or replace function public.get_session_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.session_history_json(auth.uid(), pg_catalog.now())
$$;
create or replace function public.get_dashboard() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.dashboard_json(auth.uid(), pg_catalog.now())
$$;
create or replace function public.get_prayer_row(p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.prayer_row_json(auth.uid(), pg_catalog.now(), p_date)
$$;
create or replace function public.list_regions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.list_regions(auth.uid(), pg_catalog.now())
$$;

grant execute on function public.get_active_session() to authenticated;
grant execute on function public.get_night_session(uuid) to authenticated;
grant execute on function public.get_session_summary(uuid) to authenticated;
grant execute on function public.get_current_level() to authenticated;
grant execute on function public.get_level_progress() to authenticated;
grant execute on function public.get_calendar(date, date) to authenticated;
grant execute on function public.get_report(int) to authenticated;
grant execute on function public.get_activity_stats() to authenticated;
grant execute on function public.get_session_history() to authenticated;
grant execute on function public.get_dashboard() to authenticated;
grant execute on function public.get_prayer_row(date) to authenticated;
grant execute on function public.list_regions() to authenticated;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;
