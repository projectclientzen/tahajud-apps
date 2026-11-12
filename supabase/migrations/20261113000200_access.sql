-- User and access tables (PRD v1.2 §17.1).

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  -- Normalized: trim, lowercase, NFC. The API normalizes, the check keeps the rule even if it forgets.
  email_normalized text not null unique check (email_normalized = lower(btrim(email_normalized))),
  region_id uuid references public.regions (id) on delete set null,
  -- {fajr, maghrib, timezone}. Effective timezone comes from the region or from here (BUG-14).
  manual_schedule jsonb check (manual_schedule is null or manual_schedule ? 'timezone'),
  program_start_date date,
  onboarding_completed boolean not null default false,
  theme_pref text not null default 'system' check (theme_pref in ('system', 'light', 'dark', 'auto-night')),
  quran_font_size int not null default 30 check (quran_font_size between 24 and 44),
  dhikr_font_size int not null default 28 check (dhikr_font_size between 26 and 34),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function app_private.touch_updated_at();

create table if not exists public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('super_admin', 'content_admin', 'support_admin', 'reporting_admin')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  user_agent_summary text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists user_devices_active_idx on public.user_devices (user_id) where revoked_at is null;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  scalev_order_id text not null unique,
  customer_email_normalized text not null,
  buyer_name text,
  payment_status text not null,
  amount numeric(14, 2),
  currency text not null default 'IDR',
  verified_via text check (verified_via in ('scalev_api', 'admin_manual')),
  payment_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_orders_email_idx on public.purchase_orders (customer_email_normalized);
drop trigger if exists purchase_orders_touch on public.purchase_orders;
create trigger purchase_orders_touch before update on public.purchase_orders
  for each row execute function app_private.touch_updated_at();

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  product_id text not null,
  variant_id text,
  quantity int not null default 1 check (quantity > 0)
);
create index if not exists purchase_order_items_order_idx on public.purchase_order_items (purchase_order_id);

create table if not exists public.access_entitlements (
  id uuid primary key default gen_random_uuid(),
  -- Set null on account deletion: the entitlement is anonymized and kept (PRD §24.4).
  user_id uuid references auth.users (id) on delete set null,
  email_normalized text not null,
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  entitlement_type text not null default 'lifetime' check (entitlement_type in ('lifetime')),
  status text not null check (status in ('pending_verification', 'active', 'suspended', 'revoked', 'expired')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  transferred_from_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One fulfillment per order and type. Manual grants have no order, and nulls are distinct.
  unique (purchase_order_id, entitlement_type)
);
create index if not exists access_entitlements_user_idx on public.access_entitlements (user_id) where user_id is not null;
create index if not exists access_entitlements_email_idx on public.access_entitlements (email_normalized);
drop trigger if exists access_entitlements_touch on public.access_entitlements;
create trigger access_entitlements_touch before update on public.access_entitlements
  for each row execute function app_private.touch_updated_at();

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  -- The provider event id, or the SHA-256 of the raw body when it has none (BUG-16).
  external_event_id text not null,
  event_type text not null,
  payload_minimal jsonb not null default '{}'::jsonb,
  -- Encrypted raw payload, purged after 90 days (PROV, SEC-07). Never plain text.
  payload_encrypted bytea,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_status text not null default 'received'
    check (process_status in ('received', 'processing', 'awaiting_order_verification', 'done', 'failed', 'ignored')),
  attempt_count int not null default 0,
  error_message text,
  unique (provider, external_event_id)
);
create index if not exists webhook_events_status_idx on public.webhook_events (process_status, received_at);
