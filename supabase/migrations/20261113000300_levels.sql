-- Level and activity configuration (PRD v1.2 §17.2).

create table if not exists public.levels (
  id uuid primary key default gen_random_uuid(),
  level_number smallint not null unique check (level_number between 1 and 3),
  title text not null,
  description text,
  required_successful_nights int not null check (required_successful_nights > 0),
  suggested_period_nights int,
  estimated_duration_minutes int,
  provisional boolean not null default true,
  is_active boolean not null default true
);

create table if not exists public.activity_definitions (
  id uuid primary key default gen_random_uuid(),
  activity_key text not null unique,
  activity_type text not null check (activity_type in ('prayer', 'dhikr', 'checklist', 'quran')),
  title text not null,
  -- Owner-supplied text, copied byte for byte from content/amalan.v1.json by the seed script. Never edited here.
  arabic_text text,
  transliteration text,
  meaning text,
  description text,
  counter_unit text,
  source_reference text,
  -- Never guessed. Stays 'unverified' until a reviewer sets it (CLAUDE.md).
  source_classification text not null default 'unverified',
  review_status text not null default 'draft' check (review_status in ('draft', 'in_review', 'approved', 'published')),
  published_version int,
  -- Link to the Qur'an Reader, e.g. {"surah": 56} or {"surah": 65, "from": 2, "to": 3}. Position only, no text.
  quran_ref jsonb
);

create table if not exists public.level_activity_config (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.levels (id) on delete cascade,
  activity_definition_id uuid not null references public.activity_definitions (id) on delete restrict,
  sequence_order int not null,
  phase text not null check (phase in ('night', 'fajr', 'post_fajr')),
  required_for_completion boolean not null,
  target_count int check (target_count is null or target_count > 0),
  -- Set only when a level words the activity differently from its definition (e.g. "Salat Witir (1 rakaat)").
  title_override text,
  config_version int not null default 1,
  provisional boolean not null default true,
  is_active boolean not null default true,
  -- The same dhikr (e.g. tahlil) appears in the night and after Fajr, so the phase is part of the identity.
  unique (level_id, activity_definition_id, phase)
);
create index if not exists level_activity_config_level_idx on public.level_activity_config (level_id, phase, sequence_order);

create table if not exists public.content_versions (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id uuid not null,
  version_number int not null,
  snapshot_json jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published')),
  submitted_by uuid references auth.users (id) on delete set null,
  reviewer_id uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  -- Four eyes: the reviewer is never the submitter (PRD §23.3).
  check (reviewer_id is null or reviewer_id is distinct from submitted_by),
  unique (content_type, content_id, version_number)
);

create table if not exists public.user_level_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_level smallint not null default 1 check (current_level between 1 and 3),
  level_1_unlocked_at timestamptz,
  level_2_unlocked_at timestamptz,
  level_3_unlocked_at timestamptz,
  -- First session key that uses each level. The domain model keeps one date per level (S2), so we do too.
  level_2_effective_from date,
  level_3_effective_from date,
  -- Latest of the two, as the PRD column. Derived so it cannot disagree.
  effective_from_session_key date generated always as (greatest(level_2_effective_from, level_3_effective_from)) stored,
  journey_completed_at timestamptz
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  provisional boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
