-- Foundation: private schema, shared helpers, regions and prayer times (PRD v1.2 §17.6).
-- Safe to run twice on the same database.

create schema if not exists app_private;
comment on schema app_private is 'Internal functions. Never exposed through the API.';

create or replace function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end $$;

create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  province_name text not null,
  city_name text not null,
  provider_region_code text unique,
  timezone text not null check (timezone in ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')),
  is_supported boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.prayer_times (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete cascade,
  local_date date not null,
  fajr_at timestamptz not null,
  maghrib_at timestamptz,
  provider text not null,
  fetched_at timestamptz not null default now(),
  valid_until timestamptz,
  source_revision text,
  unique (region_id, local_date, provider)
);
