-- System tables (PRD v1.2 §17.7). All backend-only.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  run_after timestamptz not null default now(),
  attempt_count int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  locked_at timestamptz,
  locked_by text
);
-- Workers take queued jobs with FOR UPDATE SKIP LOCKED, oldest first.
create index if not exists jobs_queue_idx on public.jobs (run_after) where status = 'queued';

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempt_count int not null default 0,
  sent_at timestamptz,
  provider_message_id text
);
create index if not exists email_outbox_status_idx on public.email_outbox (status) where status in ('queued', 'failed');

create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: the request outlives the deleted account.
  user_id uuid not null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'requested' check (status in ('requested', 'processing', 'done'))
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  entity_type text not null,
  entity_id text,
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  approval_reference text,
  occurred_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_entity_idx on public.admin_audit_logs (entity_type, entity_id, occurred_at);
