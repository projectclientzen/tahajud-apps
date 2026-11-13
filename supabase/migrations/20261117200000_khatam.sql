-- Khatam target (CHANGE-2026-11-13 M2). One running target per user, 30 days, 1 to 5 khatam.
-- Same rules as src/domain/khatam (checked against it in tests/db/khatam-rules.test.ts):
--   * per prayer slot 4N pages, the 4N pages left over from 604N go to day 30, spread over its five slots,
--     the first slots taking the remainder. PROVISIONAL: the owner has not decided this.
--   * day numbers use the timezone saved on the target, not the server or browser zone.
--   * nothing resets for a missed day and nothing locks.
-- The browser role can only READ its own rows and call the named functions. No direct INSERT/UPDATE/DELETE.

create table if not exists public.khatam_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  khatam_count smallint not null check (khatam_count between 1 and 5),
  start_date date not null,
  timezone text not null check (timezone in ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')),
  -- Pages added or removed by "read up to page X" marks, on top of the ticked slots.
  adjustment int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when the user starts a newer target. The old row is kept for history.
  ended_at timestamptz
);
create unique index if not exists khatam_targets_one_running on public.khatam_targets (user_id) where ended_at is null;

create table if not exists public.khatam_reads (
  target_id uuid not null references public.khatam_targets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  day smallint not null check (day between 1 and 30),
  prayer text not null check (prayer in ('subuh', 'dzuhur', 'ashar', 'maghrib', 'isya')),
  -- What the slot was worth when it was ticked, so changing N later rewrites nothing.
  pages int not null check (pages > 0),
  read_at timestamptz not null default now(),
  primary key (target_id, day, prayer)
);
create index if not exists khatam_reads_user_idx on public.khatam_reads (user_id);

alter table public.khatam_targets enable row level security;
alter table public.khatam_reads enable row level security;
revoke all on public.khatam_targets, public.khatam_reads from anon, authenticated;
drop policy if exists own_select on public.khatam_targets;
create policy own_select on public.khatam_targets for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_select on public.khatam_reads;
create policy own_select on public.khatam_reads for select to authenticated using (user_id = (select auth.uid()));
grant select on public.khatam_targets, public.khatam_reads to authenticated;

-- ---------- rules ----------
create or replace function app_private.khatam_prayer_index(p_prayer text) returns int
language sql immutable set search_path = '' as $$
  select case p_prayer when 'subuh' then 0 when 'dzuhur' then 1 when 'ashar' then 2 when 'maghrib' then 3 when 'isya' then 4 end
$$;

-- slotPages (src/domain/khatam/plan.ts)
create or replace function app_private.khatam_slot_pages(p_n int, p_day int, p_prayer text) returns int
language plpgsql immutable set search_path = '' as $$
declare v_idx int := app_private.khatam_prayer_index(p_prayer); v_last int; v_each int; v_extra int;
begin
  if p_n is null or p_n not between 1 and 5 or p_day is null or p_day not between 1 and 30 or v_idx is null then
    perform app_private.fail('VALIDATION_ERROR', 'khatam_slot');
  end if;
  if p_day < 30 then return 4 * p_n; end if;
  v_last := 24 * p_n;
  v_each := v_last / 5;
  v_extra := v_last % 5;
  return v_each + case when v_idx < v_extra then 1 else 0 end;
end $$;

-- Pages read: ticked slots plus adjustment, kept inside 0..604N (pagesRead in progress.ts).
create or replace function app_private.khatam_pages_read(p_target uuid) returns int
language sql stable set search_path = '' as $$
  select least(greatest(
    coalesce((select sum(r.pages) from public.khatam_reads r where r.target_id = p_target), 0) + t.adjustment, 0),
    604 * t.khatam_count)::int
  from public.khatam_targets t where t.id = p_target
$$;

create or replace function app_private.khatam_day_number(p_target uuid, p_now timestamptz) returns int
language sql stable set search_path = '' as $$
  select ((p_now at time zone t.timezone)::date - t.start_date) + 1 from public.khatam_targets t where t.id = p_target
$$;

create or replace function app_private.khatam_state_json(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare t public.khatam_targets;
begin
  select * into t from public.khatam_targets where user_id = p_uid and ended_at is null;
  return pg_catalog.jsonb_build_object(
    'target', case when t.id is null then null else pg_catalog.jsonb_build_object(
      'id', t.id, 'khatam_count', t.khatam_count, 'start_date', t.start_date, 'end_date', t.start_date + 29,
      'timezone', t.timezone, 'adjustment', t.adjustment, 'created_at', app_private.iso(t.created_at)) end,
    'reads', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day', r.day, 'prayer', r.prayer, 'pages', r.pages)
        order by r.day, app_private.khatam_prayer_index(r.prayer))
      from public.khatam_reads r where r.target_id = t.id), '[]'::jsonb),
    'server_now', app_private.iso(p_now));
end $$;

create or replace function app_private.get_khatam(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.require_active(p_uid, p_now);
  return app_private.khatam_state_json(p_uid, p_now);
end $$;

-- A new target is allowed when none runs, the running one is fully read, or its 30 days are over.
create or replace function app_private.create_khatam(p_uid uuid, p_now timestamptz, p_count int) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tz text; t public.khatam_targets; v_total int;
begin
  perform app_private.require_active(p_uid, p_now);
  if p_count is null or p_count not between 1 and 5 then perform app_private.fail('VALIDATION_ERROR', 'khatam_count'); end if;
  v_tz := app_private.user_timezone(p_uid);
  if v_tz is null then perform app_private.fail('VALIDATION_ERROR', 'timezone'); end if;
  -- Serialise two quick taps of the same user so the unique index never has to refuse one.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('khatam:' || p_uid::text, 0));
  select * into t from public.khatam_targets where user_id = p_uid and ended_at is null for update;
  if t.id is not null then
    v_total := 604 * t.khatam_count;
    if app_private.khatam_pages_read(t.id) < v_total and app_private.khatam_day_number(t.id, p_now) <= 30 then
      perform app_private.fail('VALIDATION_ERROR', 'target_running');
    end if;
    update public.khatam_targets set ended_at = p_now, updated_at = p_now where id = t.id;
  end if;
  insert into public.khatam_targets (user_id, khatam_count, start_date, timezone, created_at, updated_at)
  values (p_uid, p_count, (p_now at time zone v_tz)::date, v_tz, p_now, p_now);
  return app_private.khatam_state_json(p_uid, p_now);
end $$;

-- Change N for the running target. Ticked slots and marks keep their pages, only the total and the plan move.
create or replace function app_private.change_khatam_count(p_uid uuid, p_now timestamptz, p_count int) returns jsonb
language plpgsql set search_path = '' as $$
declare t public.khatam_targets;
begin
  perform app_private.require_active(p_uid, p_now);
  if p_count is null or p_count not between 1 and 5 then perform app_private.fail('VALIDATION_ERROR', 'khatam_count'); end if;
  select * into t from public.khatam_targets where user_id = p_uid and ended_at is null for update;
  if t.id is null then perform app_private.fail('NOT_FOUND', 'khatam'); end if;
  if app_private.khatam_day_number(t.id, p_now) > 30 then perform app_private.fail('VALIDATION_ERROR', 'period_over'); end if;
  update public.khatam_targets set khatam_count = p_count, updated_at = p_now where id = t.id;
  return app_private.khatam_state_json(p_uid, p_now);
end $$;

-- Tick or untick one slot of a day from 1 up to today. A set, not a toggle: replaying it changes nothing.
-- Days after the 30th are refused, but a tick made on day 30 and sent later still lands (the day is the slot's own).
create or replace function app_private.set_khatam_slot(p_uid uuid, p_now timestamptz, p_day int, p_prayer text, p_done boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare t public.khatam_targets; v_today int;
begin
  perform app_private.require_active(p_uid, p_now);
  if p_day is null or p_day not between 1 and 30 or app_private.khatam_prayer_index(p_prayer) is null or p_done is null then
    perform app_private.fail('VALIDATION_ERROR', 'slot');
  end if;
  select * into t from public.khatam_targets where user_id = p_uid and ended_at is null for update;
  if t.id is null then perform app_private.fail('NOT_FOUND', 'khatam'); end if;
  v_today := app_private.khatam_day_number(t.id, p_now);
  if p_day > v_today then perform app_private.fail('VALIDATION_ERROR', 'future_day'); end if;
  if p_done then
    insert into public.khatam_reads (target_id, user_id, day, prayer, pages, read_at)
    values (t.id, p_uid, p_day, p_prayer, app_private.khatam_slot_pages(t.khatam_count, p_day, p_prayer), p_now)
    on conflict (target_id, day, prayer) do nothing;
  else
    delete from public.khatam_reads where target_id = t.id and day = p_day and prayer = p_prayer;
  end if;
  update public.khatam_targets set updated_at = p_now where id = t.id;
  return app_private.khatam_state_json(p_uid, p_now);
end $$;

-- "Read up to page X" (positionAfterMark): the k*604+X closest to the current position, ties go forward.
create or replace function app_private.mark_khatam_position(p_uid uuid, p_now timestamptz, p_page int) returns jsonb
language plpgsql set search_path = '' as $$
declare t public.khatam_targets; v_cur int; v_total int; v_k int; v_best int; v_ticked int;
begin
  perform app_private.require_active(p_uid, p_now);
  if p_page is null or p_page not between 1 and 604 then perform app_private.fail('VALIDATION_ERROR', 'page'); end if;
  select * into t from public.khatam_targets where user_id = p_uid and ended_at is null for update;
  if t.id is null then perform app_private.fail('NOT_FOUND', 'khatam'); end if;
  v_total := 604 * t.khatam_count;
  v_cur := app_private.khatam_pages_read(t.id);
  v_k := v_cur / 604;
  select c.cand into v_best
  from (select k * 604 + p_page as cand from pg_catalog.generate_series(v_k - 1, v_k + 1) as k) c
  -- k >= 0 means cand >= page: "page X of khatam k+1". Without it page 604 with k = -1 would give position 0.
  where c.cand >= p_page and c.cand <= v_total
  order by pg_catalog.abs(c.cand - v_cur), c.cand desc
  limit 1;
  select coalesce(sum(r.pages), 0) into v_ticked from public.khatam_reads r where r.target_id = t.id;
  update public.khatam_targets set adjustment = v_best - v_ticked, updated_at = p_now where id = t.id;
  return app_private.khatam_state_json(p_uid, p_now);
end $$;

-- ---------- public wrappers: only auth.uid() and the server clock ----------
create or replace function public.get_khatam() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.get_khatam(auth.uid(), app_private.server_now())
$$;
create or replace function public.create_khatam(p_count int) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.create_khatam(auth.uid(), app_private.server_now(), p_count)
$$;
create or replace function public.change_khatam_count(p_count int) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.change_khatam_count(auth.uid(), app_private.server_now(), p_count)
$$;
create or replace function public.set_khatam_slot(p_day int, p_prayer text, p_done boolean) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.set_khatam_slot(auth.uid(), app_private.server_now(), p_day, p_prayer, p_done)
$$;
create or replace function public.mark_khatam_position(p_page int) returns jsonb
language sql security definer set search_path = '' as $$
  select app_private.mark_khatam_position(auth.uid(), app_private.server_now(), p_page)
$$;

grant execute on function public.get_khatam() to authenticated;
grant execute on function public.create_khatam(int) to authenticated;
grant execute on function public.change_khatam_count(int) to authenticated;
grant execute on function public.set_khatam_slot(int, text, boolean) to authenticated;
grant execute on function public.mark_khatam_position(int) to authenticated;

grant all on public.khatam_targets, public.khatam_reads to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;
