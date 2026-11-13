-- X4: email + password sign-in, account activation by email + phone of a paid order (CLAUDE.md auth rules,
-- SCALEV-AUTH-PLAN §3 and §8). Replaces the OTP tables and functions. Safe to run twice.
--
-- Rules this migration enforces in the database, not only in code:
--   * Only a hash of a password is ever stored, and the column refuses anything that is not a PHC style hash.
--   * An account is created in one place: activate_account(), after email AND phone match a verified, paid order.
--   * One activation per entitlement. An entitlement that has a user cannot be activated again.
--   * Admin reset links are stored as a keyed hash, work once, expire, and a new link revokes the old ones.

-- ---------- remove OTP ----------
drop function if exists app_private.otp_issue(text, text, timestamptz);
drop function if exists app_private.otp_verify(text, text, timestamptz);
drop function if exists app_private.provision_user(uuid, text, timestamptz);
drop table if exists public.login_otps;

-- ---------- orders: phone proof and CS block ----------
-- Keyed hash (HMAC with the server pepper) of the normalized phone from the verified Scalev order. Never the number.
alter table public.purchase_orders add column if not exists customer_phone_hash text;
alter table public.purchase_orders add column if not exists activation_blocked boolean not null default false;
create index if not exists purchase_orders_phone_idx on public.purchase_orders (customer_phone_hash)
  where customer_phone_hash is not null;

-- ---------- entitlements: staff accounts ----------
-- staff_comp is created by an admin only, has no order, and is kept out of buyer reports (CLAUDE.md).
alter table public.access_entitlements drop constraint if exists access_entitlements_entitlement_type_check;
alter table public.access_entitlements add constraint access_entitlements_entitlement_type_check
  check (entitlement_type in ('lifetime', 'staff_comp'));
alter table public.access_entitlements add column if not exists granted_by uuid references auth.users (id) on delete set null;
alter table public.access_entitlements drop constraint if exists access_entitlements_staff_no_order;
alter table public.access_entitlements add constraint access_entitlements_staff_no_order
  check (entitlement_type <> 'staff_comp' or purchase_order_id is null);

-- ---------- credentials ----------
create table if not exists public.auth_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- PHC string, for example "$scrypt$ln=15,r=8,p=3$<salt>$<hash>". The check keeps a plain text value out.
  password_hash text not null check (password_hash ~ '^\$[a-z0-9-]+\$.{20,}$'),
  password_changed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists auth_credentials_touch on public.auth_credentials;
create trigger auth_credentials_touch before update on public.auth_credentials
  for each row execute function app_private.touch_updated_at();

-- Reset links made by an admin (CS sends them by hand). Only the hash of the token is stored.
create table if not exists public.auth_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null default 'reset' check (purpose = 'reset'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists auth_tokens_open_idx on public.auth_tokens (user_id) where used_at is null and revoked_at is null;

-- What happened, without email or phone. ip_hash is a keyed hash. The row outlives the account (user_id nulls out).
create table if not exists public.auth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('activated', 'reset_self', 'reset_admin', 'password_changed')),
  at timestamptz not null,
  ip_hash text
);
create index if not exists auth_events_user_idx on public.auth_events (user_id, at);

alter table public.auth_credentials enable row level security;
alter table public.auth_tokens enable row level security;
alter table public.auth_events enable row level security;
revoke all on public.auth_credentials, public.auth_tokens, public.auth_events from anon, authenticated;

-- ---------- settings (all provisional) ----------
insert into public.app_settings (key, value, provisional)
values ('reset_token_minutes', '60'::jsonb, true)
on conflict (key) do nothing;

-- ---------- rate limit read (the failure counters need a peek before the attempt) ----------
create or replace function app_private.rate_count(p_key text, p_now timestamptz, p_window_seconds int) returns int
language sql stable set search_path = '' as $$
  select coalesce((
    select r.count from public.rate_limits r
    where r.key = p_key
      and r.window_start = pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch', p_now) / p_window_seconds) * p_window_seconds)
  ), 0)
$$;

-- ---------- login ----------
-- {user_id, password_hash} for an email that has a password, else null. The caller always runs a hash check, so a
-- missing account costs the same time as a wrong password.
create or replace function app_private.credential_for_login(p_email text) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('user_id', c.user_id, 'password_hash', c.password_hash)
  from public.profiles p join public.auth_credentials c on c.user_id = p.user_id
  where p.email_normalized = p_email
$$;

-- A cheaper hash made with the current settings replaces an older one after a correct login.
create or replace function app_private.credential_rehash(p_uid uuid, p_old_hash text, p_new_hash text, p_now timestamptz) returns void
language sql set search_path = '' as $$
  update public.auth_credentials set password_hash = p_new_hash, password_changed_at = password_changed_at
  where user_id = p_uid and password_hash = p_old_hash
$$;

-- ---------- activation ----------
-- One transaction. {ok:true, user_id} or {ok:false}. There is only one failure answer: nothing here says whether the
-- email is unknown, the phone is wrong, the order is unpaid, or the account already exists.
create or replace function app_private.activate_account(p_email text, p_phone_hash text, p_password_hash text, p_ip_hash text, p_now timestamptz)
returns jsonb
-- SECURITY DEFINER: the backend role has no direct write access to auth.users. Only this function creates accounts.
language plpgsql security definer set search_path = '' as $$
declare v_ent_id uuid; v_uid uuid;
begin
  if p_email is null or p_phone_hash is null or p_password_hash is null then return pg_catalog.jsonb_build_object('ok', false); end if;
  -- Two requests for the same email take turns. The second one finds the account and fails.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('activate:' || p_email));
  if exists (select 1 from public.profiles pr where pr.email_normalized = p_email)
     or exists (select 1 from auth.users u where u.email = p_email) then
    return pg_catalog.jsonb_build_object('ok', false);
  end if;
  select e.id into v_ent_id
  from public.access_entitlements e
  join public.purchase_orders o on o.id = e.purchase_order_id
  where e.email_normalized = p_email
    and e.entitlement_type = 'lifetime'
    and e.status = 'active'
    and e.user_id is null
    and e.starts_at <= p_now and (e.expires_at is null or e.expires_at > p_now)
    and o.customer_phone_hash = p_phone_hash
    and o.verified_via = 'scalev_api'
    and o.payment_status in ('paid', 'settled')
    and not o.activation_blocked
  order by e.created_at
  limit 1
  for update of e;
  if v_ent_id is null then return pg_catalog.jsonb_build_object('ok', false); end if;

  v_uid := gen_random_uuid();
  insert into auth.users (id, email) values (v_uid, p_email);
  insert into public.profiles (user_id, email_normalized) values (v_uid, p_email);
  insert into public.auth_credentials (user_id, password_hash, password_changed_at) values (v_uid, p_password_hash, p_now);
  -- Every unclaimed entitlement of this email that was bought with this same phone moves to the new account.
  update public.access_entitlements e set user_id = v_uid
  where e.user_id is null and e.email_normalized = p_email and e.entitlement_type = 'lifetime'
    and e.purchase_order_id in (
      select o.id from public.purchase_orders o where o.customer_phone_hash = p_phone_hash and not o.activation_blocked);
  insert into public.auth_events (user_id, kind, at, ip_hash) values (v_uid, 'activated', p_now, p_ip_hash);
  return pg_catalog.jsonb_build_object('ok', true, 'user_id', v_uid);
end $$;

-- ---------- reset by the buyer (email + phone of the same order) ----------
create or replace function app_private.reset_password_self(p_email text, p_phone_hash text, p_new_hash text, p_ip_hash text, p_now timestamptz)
returns jsonb
language plpgsql set search_path = '' as $$
declare v_uid uuid;
begin
  if p_email is null or p_phone_hash is null or p_new_hash is null then return pg_catalog.jsonb_build_object('ok', false); end if;
  select p.user_id into v_uid
  from public.profiles p join public.auth_credentials c on c.user_id = p.user_id
  where p.email_normalized = p_email
  for update of c;
  if v_uid is null then return pg_catalog.jsonb_build_object('ok', false); end if;
  if not exists (
    select 1 from public.access_entitlements e join public.purchase_orders o on o.id = e.purchase_order_id
    where e.user_id = v_uid and o.customer_phone_hash = p_phone_hash and not o.activation_blocked
  ) then
    return pg_catalog.jsonb_build_object('ok', false);
  end if;
  update public.auth_credentials set password_hash = p_new_hash, password_changed_at = p_now where user_id = v_uid;
  update public.user_devices set revoked_at = p_now where user_id = v_uid and revoked_at is null;
  delete from public.pending_logins where user_id = v_uid and used_at is null;
  update public.auth_tokens set revoked_at = p_now where user_id = v_uid and used_at is null and revoked_at is null;
  insert into public.auth_events (user_id, kind, at, ip_hash) values (v_uid, 'reset_self', p_now, p_ip_hash);
  return pg_catalog.jsonb_build_object('ok', true, 'user_id', v_uid);
end $$;

-- ---------- reset link made by an admin ----------
-- Interface for the admin task (X8): the backend creates the random token, passes only its hash. A reason is required
-- and the action is written to the audit log. A new link revokes every open link of the same account.
create or replace function app_private.password_token_issue(
  p_actor uuid, p_target_uid uuid, p_token_hash text, p_reason text, p_now timestamptz, p_ttl_seconds int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ttl int; v_exp timestamptz;
begin
  if p_reason is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) < 3 then
    perform app_private.fail('VALIDATION_ERROR', 'reason');
  end if;
  if p_token_hash is null or pg_catalog.char_length(p_token_hash) < 32 then perform app_private.fail('VALIDATION_ERROR', 'token'); end if;
  if not exists (select 1 from auth.users u where u.id = p_target_uid) then perform app_private.fail('NOT_FOUND'); end if;
  v_ttl := coalesce(p_ttl_seconds, app_private.int_setting('reset_token_minutes', 60) * 60);
  v_exp := p_now + pg_catalog.make_interval(secs => v_ttl);
  update public.auth_tokens set revoked_at = p_now where user_id = p_target_uid and used_at is null and revoked_at is null;
  insert into public.auth_tokens (token_hash, user_id, created_by, created_at, expires_at)
  values (p_token_hash, p_target_uid, p_actor, p_now, v_exp);
  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, reason, occurred_at)
  values (p_actor, 'user', p_target_uid::text, 'password_reset_link_created', pg_catalog.btrim(p_reason), p_now);
  return pg_catalog.jsonb_build_object('expires_at', app_private.iso(v_exp));
end $$;

-- Atomic: one UPDATE decides who wins, so two requests with the same token cannot both succeed.
create or replace function app_private.password_token_consume(p_token_hash text, p_new_hash text, p_ip_hash text, p_now timestamptz)
returns jsonb
language plpgsql set search_path = '' as $$
declare v_uid uuid;
begin
  update public.auth_tokens set used_at = p_now
  where token_hash = p_token_hash and used_at is null and revoked_at is null and expires_at > p_now
  returning user_id into v_uid;
  if v_uid is null then return pg_catalog.jsonb_build_object('ok', false); end if;
  insert into public.auth_credentials (user_id, password_hash, password_changed_at)
  values (v_uid, p_new_hash, p_now)
  on conflict (user_id) do update set password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at;
  update public.user_devices set revoked_at = p_now where user_id = v_uid and revoked_at is null;
  delete from public.pending_logins where user_id = v_uid and used_at is null;
  update public.auth_tokens set revoked_at = p_now where user_id = v_uid and used_at is null and revoked_at is null;
  insert into public.auth_events (user_id, kind, at, ip_hash) values (v_uid, 'reset_admin', p_now, p_ip_hash);
  return pg_catalog.jsonb_build_object('ok', true, 'user_id', v_uid);
end $$;

-- ---------- change password while signed in ----------
-- The caller has already checked the current password. Every other device is signed out.
create or replace function app_private.password_change(p_uid uuid, p_new_hash text, p_current_device uuid, p_ip_hash text, p_now timestamptz)
returns void
language plpgsql set search_path = '' as $$
begin
  update public.auth_credentials set password_hash = p_new_hash, password_changed_at = p_now where user_id = p_uid;
  if not found then perform app_private.fail('UNAUTHENTICATED'); end if;
  update public.user_devices set revoked_at = p_now
  where user_id = p_uid and revoked_at is null and id is distinct from p_current_device;
  update public.auth_tokens set revoked_at = p_now where user_id = p_uid and used_at is null and revoked_at is null;
  insert into public.auth_events (user_id, kind, at, ip_hash) values (p_uid, 'password_changed', p_now, p_ip_hash);
end $$;

-- ---------- account deletion also forgets the phone proof ----------
create or replace function app_private.delete_account(p_uid uuid, p_now timestamptz, p_email_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if p_uid is null then perform app_private.fail('UNAUTHENTICATED'); end if;
  if p_email_hash is null or char_length(p_email_hash) < 16 then perform app_private.fail('VALIDATION_ERROR', 'hash'); end if;
  select p.email_normalized into v_email from public.profiles p where p.user_id = p_uid;
  if not found then perform app_private.fail('NOT_FOUND'); end if;

  update public.access_entitlements set user_id = null, email_normalized = p_email_hash
  where user_id = p_uid or email_normalized = v_email;
  update public.access_entitlements set transferred_from_email = p_email_hash where transferred_from_email = v_email;
  update public.purchase_orders set customer_email_normalized = p_email_hash, buyer_name = null, customer_phone_hash = null
  where customer_email_normalized = v_email;

  -- Copies of the address outside the tables above.
  update public.email_outbox set to_email = p_email_hash, payload = '{}'::jsonb where lower(to_email) = v_email;
  update public.webhook_events set payload_minimal =
    regexp_replace(payload_minimal::text, regexp_replace(v_email, '([.+*?^$(){}|\[\]\\])', '\\\1', 'g'), p_email_hash, 'gi')::jsonb
  where position(v_email in lower(payload_minimal::text)) > 0;
  -- Work still waiting for this person must not run: no email to a deleted account, no push to its devices.
  delete from public.jobs where status in ('queued', 'failed')
    and (payload ->> 'user_id' = p_uid::text or lower(payload ->> 'email') = v_email);
  update public.session_audit_logs set actor_id = null where actor_id = p_uid;

  insert into public.data_deletion_requests (user_id, requested_at, processed_at, status)
  values (p_uid, p_now, p_now, 'done');
  delete from auth.users where id = p_uid;
  return pg_catalog.jsonb_build_object('deleted_at', app_private.iso(p_now));
end $$;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;
