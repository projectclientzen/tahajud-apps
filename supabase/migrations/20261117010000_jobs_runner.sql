-- T6: job runner and notification scheduler plumbing (PRD v1.2 §15, §16.2, §17.5, §17.7). Safe to run twice.
-- Runs after 20261116030000_auth_password.sql, so login_otps no longer exists. housekeeping() below knows that.
-- Everything here is backend only: functions live in app_private and only service_role may execute them.
-- Functions that depend on time take p_now (default: app_private.server_now()). The worker passes nothing in
-- production; tests pass a fixed instant. They are never reachable by a signed-in user.

-- ---------- schema additions ----------
alter table public.jobs add column if not exists dedupe_key text;
alter table public.jobs add column if not exists created_at timestamptz not null default now();
alter table public.jobs add column if not exists finished_at timestamptz;

-- "failed" = a non-retryable error (bad config, bad payload). "dead" = retries used up. A retry that is still allowed
-- goes back to "queued" with a later run_after, so jobs_queue_idx (queued only) stays the single hot index.
-- A dedupe key coalesces requests while a job is still waiting: a second "reschedule user X" adds nothing.
create unique index if not exists jobs_dedupe_queued_uq on public.jobs (dedupe_key)
  where dedupe_key is not null and status = 'queued';
create index if not exists jobs_type_status_idx on public.jobs (job_type, status, created_at desc);
create index if not exists jobs_running_idx on public.jobs (locked_at) where status = 'running';

-- The send_email handler records why a message was not sent (EMAIL_NOT_CONFIGURED until SMTP exists; SCALEV-AUTH-PLAN §8.9).
alter table public.email_outbox add column if not exists last_error text;

alter table public.notification_jobs add column if not exists template_key text;
alter table public.notification_jobs add column if not exists skip_reason text;
alter table public.notification_jobs add column if not exists last_error text;
alter table public.notification_jobs add column if not exists sent_at timestamptz;
alter table public.notification_jobs add column if not exists locked_until timestamptz;
alter table public.notification_jobs add column if not exists locked_by text;
create index if not exists notification_jobs_user_date_idx on public.notification_jobs (user_id, local_schedule_date);
create index if not exists notification_jobs_expiry_idx on public.notification_jobs (expires_at) where status = 'pending';

-- ---------- queue ----------
create or replace function app_private.jobs_enqueue(
  p_type text, p_payload jsonb default '{}'::jsonb, p_run_after timestamptz default null,
  p_dedupe_key text default null, p_max_attempts int default 5
) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.jobs (job_type, payload, run_after, dedupe_key, max_attempts)
  values (p_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_after, app_private.server_now()), p_dedupe_key, p_max_attempts)
  on conflict (dedupe_key) where dedupe_key is not null and status = 'queued' do nothing
  returning id into v_id;
  return v_id; -- null when an identical job is already waiting
end $$;

-- One recurring job per type. The advisory lock makes two instances ticking at the same moment agree on who enqueues.
create or replace function app_private.jobs_enqueue_recurring(
  p_type text, p_every_seconds int, p_payload jsonb default '{}'::jsonb, p_now timestamptz default null
) returns uuid
language plpgsql set search_path = '' as $$
declare v_now timestamptz := coalesce(p_now, app_private.server_now()); v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('jobs_recurring:' || p_type, 0));
  if exists (
    select 1 from public.jobs j
    where j.job_type = p_type
      and (j.status in ('queued', 'running') or j.created_at > v_now - pg_catalog.make_interval(secs => p_every_seconds))
  ) then
    return null;
  end if;
  insert into public.jobs (job_type, payload, run_after, created_at) values (p_type, p_payload, v_now, v_now)
  returning id into v_id;
  return v_id;
end $$;

-- Takes up to p_limit jobs that are due. FOR UPDATE SKIP LOCKED: two workers never get the same row, and neither waits for the other.
-- A "running" job whose lease ran out (worker died) is taken again, unless its attempts are used up: then it is dead.
create or replace function app_private.jobs_claim(
  p_worker text, p_limit int default 5, p_lease_seconds int default 300, p_now timestamptz default null
) returns setof public.jobs
language plpgsql set search_path = '' as $$
declare v_now timestamptz := coalesce(p_now, app_private.server_now());
begin
  update public.jobs set status = 'dead', finished_at = v_now, locked_at = null, locked_by = null,
         last_error = coalesce(last_error, 'worker lost') || ' (lease expired, attempts used up)'
  where status = 'running' and locked_at < v_now - pg_catalog.make_interval(secs => p_lease_seconds)
    and attempt_count >= max_attempts;

  return query
  with picked as (
    select id from public.jobs
    where (status = 'queued' and run_after <= v_now)
       or (status = 'running' and locked_at < v_now - pg_catalog.make_interval(secs => p_lease_seconds))
    order by run_after, id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.jobs j
  set status = 'running', attempt_count = j.attempt_count + 1, locked_at = v_now, locked_by = p_worker
  from picked where j.id = picked.id
  returning j.*;
end $$;

create or replace function app_private.jobs_complete(p_id uuid, p_worker text, p_now timestamptz default null) returns boolean
language plpgsql set search_path = '' as $$
begin
  update public.jobs set status = 'done', finished_at = coalesce(p_now, app_private.server_now()),
         locked_at = null, locked_by = null, last_error = null
  where id = p_id and status = 'running' and locked_by = p_worker;
  return found;
end $$;

-- Returns the new status: queued (will retry), dead (no attempts left), failed (not retryable), or ignored
-- (the job is no longer ours, for example the lease expired and another worker took it).
create or replace function app_private.jobs_fail(
  p_id uuid, p_worker text, p_error text, p_retry_after_seconds int, p_retryable boolean default true, p_now timestamptz default null
) returns text
language plpgsql set search_path = '' as $$
declare v_now timestamptz := coalesce(p_now, app_private.server_now()); j public.jobs; v_err text := pg_catalog.left(coalesce(p_error, 'error'), 1000);
begin
  select * into j from public.jobs where id = p_id for update;
  if not found or j.status <> 'running' or j.locked_by is distinct from p_worker then return 'ignored'; end if;
  if not p_retryable then
    update public.jobs set status = 'failed', last_error = v_err, finished_at = v_now, locked_at = null, locked_by = null where id = p_id;
    return 'failed';
  elsif j.attempt_count >= j.max_attempts then
    update public.jobs set status = 'dead', last_error = v_err, finished_at = v_now, locked_at = null, locked_by = null where id = p_id;
    return 'dead';
  end if;
  update public.jobs set status = 'queued', last_error = v_err, locked_at = null, locked_by = null,
         run_after = v_now + pg_catalog.make_interval(secs => greatest(p_retry_after_seconds, 0))
  where id = p_id;
  return 'queued';
end $$;

-- ---------- notification delivery claim ----------
-- Pending notifications past their expiry are never sent (PRD §15.4, NOTIF-04). Runs before every claim.
create or replace function app_private.notif_expire_overdue(p_now timestamptz default null) returns int
language plpgsql set search_path = '' as $$
declare v_count int;
begin
  update public.notification_jobs set status = 'expired', skip_reason = 'expired', locked_until = null, locked_by = null
  where status = 'pending' and expires_at < coalesce(p_now, app_private.server_now());
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Takes due, unexpired, unlocked notifications. The lease keeps a second dispatcher away while this one sends.
create or replace function app_private.notif_claim_due(
  p_worker text, p_limit int default 50, p_lease_seconds int default 120, p_now timestamptz default null
) returns setof public.notification_jobs
language plpgsql set search_path = '' as $$
declare v_now timestamptz := coalesce(p_now, app_private.server_now());
begin
  return query
  with picked as (
    select id from public.notification_jobs
    where status = 'pending' and scheduled_at <= v_now and expires_at >= v_now
      and (locked_until is null or locked_until < v_now)
    order by scheduled_at, id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.notification_jobs n
  set attempt_count = n.attempt_count + 1, locked_by = p_worker,
      locked_until = v_now + pg_catalog.make_interval(secs => p_lease_seconds)
  from picked where n.id = picked.id
  returning n.*;
end $$;

-- p_status: sent | skipped | expired | failed | pending (put back for a retry, with a later lease end).
create or replace function app_private.notif_finish(
  p_id uuid, p_worker text, p_status text, p_reason text default null, p_error text default null,
  p_retry_after_seconds int default null, p_now timestamptz default null
) returns boolean
language plpgsql set search_path = '' as $$
declare v_now timestamptz := coalesce(p_now, app_private.server_now());
begin
  if p_status not in ('sent', 'skipped', 'expired', 'failed', 'pending') then
    raise exception 'invalid notification status %', p_status;
  end if;
  update public.notification_jobs
  set status = p_status,
      skip_reason = case when p_status in ('skipped', 'expired') then p_reason else skip_reason end,
      last_error = pg_catalog.left(p_error, 1000),
      sent_at = case when p_status = 'sent' then v_now else sent_at end,
      locked_by = case when p_status = 'pending' then locked_by else null end,
      locked_until = case when p_status = 'pending' then v_now + pg_catalog.make_interval(secs => coalesce(p_retry_after_seconds, 60)) else null end
  where id = p_id and status = 'pending' and locked_by = p_worker;
  return found;
end $$;

-- ---------- reschedule triggers (PRD §15.4) ----------
-- Region, bedtime, level, preference, or subscription changed: plan this user again soon.
-- Requests coalesce while one is still waiting. The planner is idempotent, so this only has to be early, not exact.
create or replace function app_private.request_reschedule(p_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.jobs_enqueue('notification_reschedule', pg_catalog.jsonb_build_object('user_id', p_uid), null, 'resched:' || p_uid::text);
end $$;

create or replace function app_private.trg_reschedule_prefs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.request_reschedule(new.user_id);
  elsif (pg_catalog.to_jsonb(new) - 'updated_at') is distinct from (pg_catalog.to_jsonb(old) - 'updated_at') then
    perform app_private.request_reschedule(new.user_id);
  end if;
  return new;
end $$;

create or replace function app_private.trg_reschedule_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.region_id is distinct from old.region_id or new.manual_schedule is distinct from old.manual_schedule then
    perform app_private.request_reschedule(new.user_id);
  end if;
  return new;
end $$;

create or replace function app_private.trg_reschedule_level() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.current_level is distinct from old.current_level then perform app_private.request_reschedule(new.user_id); end if;
  return new;
end $$;

create or replace function app_private.trg_reschedule_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.request_reschedule(new.user_id);
  elsif new.is_active is distinct from old.is_active then
    perform app_private.request_reschedule(new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists notification_preferences_reschedule on public.notification_preferences;
create trigger notification_preferences_reschedule after insert or update on public.notification_preferences
  for each row execute function app_private.trg_reschedule_prefs();
drop trigger if exists profiles_reschedule on public.profiles;
create trigger profiles_reschedule after update on public.profiles
  for each row execute function app_private.trg_reschedule_profile();
drop trigger if exists user_level_state_reschedule on public.user_level_state;
create trigger user_level_state_reschedule after update on public.user_level_state
  for each row execute function app_private.trg_reschedule_level();
drop trigger if exists push_subscriptions_reschedule on public.push_subscriptions;
create trigger push_subscriptions_reschedule after insert or update on public.push_subscriptions
  for each row execute function app_private.trg_reschedule_push();

-- ---------- housekeeping ----------
-- Finished work and expired auth leftovers. Dead jobs stay 90 days so the admin can read them.
-- Revoked devices keep their cookie hash for 30 days so the cookie still reads "revoked" (PRD §24.1).
-- Auth: the auth migration states no retention, so these are PROVISIONAL defaults.
--   auth_tokens (admin reset links): a link that expired, was used or was revoked is deleted 7 days later (SCALEV-AUTH-PLAN §3.2).
--   auth_events (activation / reset audit, no email or phone): kept auth_events_retention_days, 90 unless the setting says otherwise.
insert into public.app_settings (key, value, provisional)
values ('auth_events_retention_days', '90'::jsonb, true)
on conflict (key) do nothing;

create or replace function app_private.housekeeping(p_now timestamptz default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, app_private.server_now());
  v_event_days int := greatest(coalesce((app_private.setting('auth_events_retention_days') #>> '{}')::int, 90), 1);
  n_jobs int; n_notif int; n_tokens int; n_events int; n_pending int; n_rate int; n_dev int;
begin
  delete from public.jobs where (status = 'done' and finished_at < v_now - interval '7 days')
    or (status = 'failed' and finished_at < v_now - interval '30 days')
    or (status = 'dead' and finished_at < v_now - interval '90 days');
  get diagnostics n_jobs = row_count;
  delete from public.notification_jobs where status <> 'pending' and scheduled_at < v_now - interval '30 days';
  get diagnostics n_notif = row_count;
  delete from public.auth_tokens
  where least(expires_at, coalesce(used_at, expires_at), coalesce(revoked_at, expires_at)) < v_now - interval '7 days';
  get diagnostics n_tokens = row_count;
  delete from public.auth_events where at < v_now - pg_catalog.make_interval(days => v_event_days);
  get diagnostics n_events = row_count;
  delete from public.pending_logins where expires_at < v_now - interval '1 day';
  get diagnostics n_pending = row_count;
  delete from public.rate_limits where window_start < v_now - interval '2 days';
  get diagnostics n_rate = row_count;
  delete from public.device_sessions s using public.user_devices d
  where d.id = s.device_id and (s.expires_at < v_now - interval '30 days' or d.revoked_at < v_now - interval '30 days');
  get diagnostics n_dev = row_count;
  return pg_catalog.jsonb_build_object('jobs', n_jobs, 'notification_jobs', n_notif, 'auth_tokens', n_tokens,
    'auth_events', n_events, 'pending_logins', n_pending, 'rate_limits', n_rate, 'device_sessions', n_dev);
end $$;

-- ---------- grants: service_role only ----------
revoke all on function app_private.jobs_enqueue(text, jsonb, timestamptz, text, int) from public, anon, authenticated;
revoke all on function app_private.jobs_enqueue_recurring(text, int, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function app_private.jobs_claim(text, int, int, timestamptz) from public, anon, authenticated;
revoke all on function app_private.jobs_complete(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function app_private.jobs_fail(uuid, text, text, int, boolean, timestamptz) from public, anon, authenticated;
revoke all on function app_private.notif_expire_overdue(timestamptz) from public, anon, authenticated;
revoke all on function app_private.notif_claim_due(text, int, int, timestamptz) from public, anon, authenticated;
revoke all on function app_private.notif_finish(uuid, text, text, text, text, int, timestamptz) from public, anon, authenticated;
revoke all on function app_private.request_reschedule(uuid) from public, anon, authenticated;
revoke all on function app_private.housekeeping(timestamptz) from public, anon, authenticated;
grant execute on function app_private.jobs_enqueue(text, jsonb, timestamptz, text, int) to service_role;
grant execute on function app_private.jobs_enqueue_recurring(text, int, jsonb, timestamptz) to service_role;
grant execute on function app_private.jobs_claim(text, int, int, timestamptz) to service_role;
grant execute on function app_private.jobs_complete(uuid, text, timestamptz) to service_role;
grant execute on function app_private.jobs_fail(uuid, text, text, int, boolean, timestamptz) to service_role;
grant execute on function app_private.notif_expire_overdue(timestamptz) to service_role;
grant execute on function app_private.notif_claim_due(text, int, int, timestamptz) to service_role;
grant execute on function app_private.notif_finish(uuid, text, text, text, text, int, timestamptz) to service_role;
grant execute on function app_private.request_reschedule(uuid) to service_role;
grant execute on function app_private.housekeeping(timestamptz) to service_role;
