-- Qur'an storage (PRD v1.2 §17.4) and notifications (§17.5). The Qur'an text itself is imported by T4.

create table if not exists public.quran_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  file_sha256 text not null,
  license_text text not null,
  attribution text not null,
  imported_at timestamptz not null default now(),
  unique (name, version, file_sha256)
);

create table if not exists public.quran_surahs (
  surah_number smallint primary key check (surah_number between 1 and 114),
  arabic_name text not null,
  latin_name text not null,
  verse_count int not null check (verse_count > 0),
  source_id uuid references public.quran_sources (id) on delete restrict
);

create table if not exists public.quran_verses (
  surah_number smallint not null references public.quran_surahs (surah_number) on delete cascade,
  verse_number int not null check (verse_number > 0),
  arabic_uthmani text not null,
  source_id uuid not null references public.quran_sources (id) on delete restrict,
  unique (surah_number, verse_number, source_id)
);

-- Separate on purpose: blocked until a translation licence exists.
create table if not exists public.quran_translations (
  surah_number smallint not null,
  verse_number int not null,
  text text not null,
  translation_source_id uuid not null references public.quran_sources (id) on delete restrict,
  unique (surah_number, verse_number, translation_source_id)
);

create table if not exists public.quran_reading_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  surah_number smallint not null check (surah_number between 1 and 114),
  last_verse int check (last_verse is null or last_verse > 0),
  status text not null default 'reading' check (status in ('reading', 'completed')),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, surah_number)
);

create table if not exists public.session_quran_completions (
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.night_sessions (id) on delete cascade,
  surah_number smallint not null check (surah_number between 1 and 114),
  completion_type text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, session_id, surah_number)
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bedtime_enabled boolean not null default true,
  bedtime_local_time time not null default '22:00',
  bedtime_offset_minutes int not null default 30 check (bedtime_offset_minutes >= 0),
  tahajud_enabled boolean not null default true,
  fajr_enabled boolean not null default true,
  alkahfi_enabled boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  quiet_hours_allow_worship boolean not null default true,
  updated_at timestamptz not null default now()
  -- No timezone column: it comes from the region (BUG-14).
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid references public.user_devices (id) on delete cascade,
  endpoint text not null unique,
  -- Keys are never returned to the client (see column grants in the security migration).
  p256dh text not null,
  auth text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id) where is_active;

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  body text not null,
  is_active boolean not null default true,
  version int not null default 1,
  review_status text not null default 'draft' check (review_status in ('draft', 'in_review', 'approved', 'published')),
  approved_at timestamptz
);

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  notification_type text not null check (notification_type in ('bedtime', 'tahajud', 'fajr', 'alkahfi', 'achievement')),
  scheduled_at timestamptz not null,
  expires_at timestamptz not null,
  local_schedule_date date not null,
  template_id uuid references public.notification_templates (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'expired', 'skipped', 'failed')),
  -- user_id:type:local_date. One job per user, type, and day (PRD §15.4).
  dedupe_key text not null unique,
  attempt_count int not null default 0
);
create index if not exists notification_jobs_due_idx on public.notification_jobs (scheduled_at) where status = 'pending';

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.notification_jobs (id) on delete cascade,
  subscription_id uuid references public.push_subscriptions (id) on delete set null,
  delivery_status text not null,
  attempted_at timestamptz not null default now(),
  provider_status_code int
);
