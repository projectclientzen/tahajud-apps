-- Worship tracking (PRD v1.2 §17.3). Written only through SECURITY DEFINER functions.

create table if not exists public.night_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Session key: the local date of Fajr (PRD §11.1).
  fajr_local_date date not null,
  -- Frozen when the session is created, so a region change mid-session does not move it (BUG-08).
  timezone text not null,
  region_id uuid references public.regions (id) on delete set null,
  schedule_source text not null check (schedule_source in ('provider', 'cached', 'manual')),
  level_number smallint not null check (level_number between 1 and 3),
  level_config_version int not null default 1,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'partial', 'missed', 'excused')),
  started_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  excused_at timestamptz,
  version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fajr_local_date)
);
-- Dashboard and level progress count sessions by status and level.
create index if not exists night_sessions_user_status_idx on public.night_sessions (user_id, level_number, status);
drop trigger if exists night_sessions_touch on public.night_sessions;
create trigger night_sessions_touch before update on public.night_sessions
  for each row execute function app_private.touch_updated_at();

create table if not exists public.session_activities (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.night_sessions (id) on delete cascade,
  -- Copied from the session so the read policy is a plain column check and the index covers it.
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_definition_id uuid not null references public.activity_definitions (id) on delete restrict,
  -- Title, kind, target and "required" as they were when the session started (PRD §22.3).
  activity_config_snapshot jsonb not null,
  phase text not null check (phase in ('night', 'fajr', 'post_fajr')),
  target_count int check (target_count is null or target_count > 0),
  actual_count int not null default 0 check (actual_count >= 0),
  required_for_completion boolean not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  completed_at timestamptz,
  -- Optimistic concurrency token for checklist updates.
  version int not null default 0,
  unique (session_id, activity_definition_id, phase)
);
create index if not exists session_activities_user_idx on public.session_activities (user_id);

create table if not exists public.counter_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_operation_id text not null check (char_length(client_operation_id) between 1 and 128),
  session_activity_id uuid not null references public.session_activities (id) on delete cascade,
  op_type text not null check (op_type in ('delta', 'set_zero')),
  delta int not null default 0 check (delta between -1000 and 1000),
  resulting_count int not null check (resulting_count >= 0),
  client_recorded_at timestamptz,
  server_applied_at timestamptz not null default now(),
  -- Exactly once per user and client operation id (SEC-13).
  unique (user_id, client_operation_id)
);
create index if not exists counter_operations_activity_idx on public.counter_operations (session_activity_id, server_applied_at);

create table if not exists public.session_audit_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.night_sessions (id) on delete cascade,
  actor_id uuid,
  operation_type text not null,
  previous_value jsonb,
  new_value jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists session_audit_logs_session_idx on public.session_audit_logs (session_id, occurred_at);
