-- T9-FIX (audit Fable 14 Nov 2026, F1..F6, F8 data side, B, C). Safe to run twice. Backend only.
--   F1/F2  failure gate: one atomic row per key. A request reserves its slot BEFORE the slow hash, so parallel requests
--          cannot all pass a count of 0. Delays grow in steps (PROVISIONAL, src/domain/config/provisional.ts), never a hard lock.
--   F4     scalev_apply_order links to an existing account only when the order phone matches an order that account owns.
--   F5     key version columns.
--   F6     reset_password_self refuses accounts that hold a role; first MFA enrolment only inside a window after the role grant.
--   B      the buyer path no longer accepts admin_manual orders. Admin gets a recheck (queues the Scalev worker) instead.
--   C      khatam data in the user's data export.

-- ---------- F1, F2: failure gate ----------
create table if not exists public.auth_fail_state (
  key text primary key,
  fails int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.auth_fail_state enable row level security;
revoke all on public.auth_fail_state from anon, authenticated;

-- Reserves one attempt. Returns {allowed, retry_after_seconds}. While a delay runs, requests are refused and NOT counted
-- (spamming cannot push the delay higher). The first p_free attempts are free; each one after that sets the next delay
-- from p_delays (the last entry repeats). A key that stays quiet for p_idle_seconds starts again from zero.
create or replace function app_private.auth_gate(p_key text, p_now timestamptz, p_free int, p_delays int[], p_idle_seconds int)
returns jsonb
language plpgsql set search_path = '' as $$
declare s public.auth_fail_state; v_delay int := 0; v_n int;
begin
  insert into public.auth_fail_state (key, fails, updated_at) values (p_key, 0, p_now) on conflict (key) do nothing;
  select * into s from public.auth_fail_state where key = p_key for update;
  if s.updated_at < p_now - pg_catalog.make_interval(secs => p_idle_seconds) then
    s.fails := 0; s.locked_until := null;
  end if;
  if s.locked_until is not null and s.locked_until > p_now then
    return pg_catalog.jsonb_build_object('allowed', false,
      'retry_after_seconds', greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', s.locked_until - p_now))::int));
  end if;
  s.fails := s.fails + 1;
  if s.fails > p_free then
    v_n := pg_catalog.array_length(p_delays, 1);
    v_delay := case when coalesce(v_n, 0) = 0 then 0 else p_delays[least(s.fails - p_free, v_n)] end;
  end if;
  update public.auth_fail_state
  set fails = s.fails, locked_until = case when v_delay > 0 then p_now + pg_catalog.make_interval(secs => v_delay) else null end,
      updated_at = p_now
  where key = p_key;
  return pg_catalog.jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end $$;

-- A good attempt gives its slot back: a correct login or a matched proof starts the key from zero.
create or replace function app_private.auth_gate_clear(p_key text) returns void
language sql set search_path = '' as $$ delete from public.auth_fail_state where key = p_key $$;

-- Gives one slot back without touching a delay that is already running.
create or replace function app_private.auth_gate_refund(p_key text, p_now timestamptz) returns void
language sql set search_path = '' as $$
  update public.auth_fail_state set fails = greatest(fails - 1, 0), updated_at = p_now where key = p_key
$$;

revoke all on function app_private.auth_gate(text, timestamptz, int, int[], int) from public, anon, authenticated;
revoke all on function app_private.auth_gate_clear(text) from public, anon, authenticated;
revoke all on function app_private.auth_gate_refund(text, timestamptz) from public, anon, authenticated;
grant execute on function app_private.auth_gate(text, timestamptz, int, int[], int) to service_role;
grant execute on function app_private.auth_gate_clear(text) to service_role;
grant execute on function app_private.auth_gate_refund(text, timestamptz) to service_role;

-- Gives one count back (a good attempt does not use the per-IP failure budget).
create or replace function app_private.rate_refund(p_key text, p_now timestamptz, p_window_seconds int) returns void
language sql set search_path = '' as $$
  update public.rate_limits set count = greatest(count - 1, 0)
  where key = p_key
    and window_start = pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch', p_now) / p_window_seconds) * p_window_seconds)
$$;
revoke all on function app_private.rate_refund(text, timestamptz, int) from public, anon, authenticated;
grant execute on function app_private.rate_refund(text, timestamptz, int) to service_role;

-- ---------- F5: key versions ----------
-- Rows hash/seal with a key. The version says which one, so a rotation can find rows still on the old key.
alter table public.purchase_orders add column if not exists phone_key_version smallint not null default 1;
alter table public.admin_mfa_factors add column if not exists key_version smallint not null default 1;

-- ---------- F4: quarantine reason ----------
alter table public.purchase_orders drop constraint if exists purchase_orders_quarantine_reason_check;
alter table public.purchase_orders add constraint purchase_orders_quarantine_reason_check
  check (quarantine_reason is null or quarantine_reason in (
    'unknown_variant', 'missing_email', 'missing_phone', 'amount_below_min', 'order_canceled', 'spam_flag',
    'post_payment_change', 'needs_cs_review'
  ));

create or replace function app_private.activate_account(p_email text, p_phone_hash text, p_password_hash text, p_ip_hash text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ent_id uuid; v_uid uuid; v_matched boolean;
begin
  if p_email is null or p_phone_hash is null or p_password_hash is null then return pg_catalog.jsonb_build_object('ok', false); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('activate:' || p_email));
  -- True when email and phone belong to the same order, whatever happens next. The caller does not count such an
  -- attempt against the failure budget (T9 F2): someone who knows both is not guessing.
  v_matched := exists (select 1 from public.purchase_orders o
                       where o.customer_email_normalized = p_email and o.customer_phone_hash = p_phone_hash
                         and not o.activation_blocked);
  if exists (select 1 from public.profiles pr where pr.email_normalized = p_email)
     or exists (select 1 from auth.users u where u.email = p_email) then
    return pg_catalog.jsonb_build_object('ok', false, 'matched', v_matched);
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
    and o.verified_via = 'scalev_api' and o.payment_status in ('paid', 'settled')
    and not o.activation_blocked
  order by e.created_at
  limit 1
  for update of e;
  if v_ent_id is null then return pg_catalog.jsonb_build_object('ok', false, 'matched', v_matched); end if;

  v_uid := gen_random_uuid();
  insert into auth.users (id, email) values (v_uid, p_email);
  insert into public.profiles (user_id, email_normalized) values (v_uid, p_email);
  insert into public.auth_credentials (user_id, password_hash, password_changed_at) values (v_uid, p_password_hash, p_now);
  update public.access_entitlements e set user_id = v_uid
  where e.user_id is null and e.email_normalized = p_email and e.entitlement_type = 'lifetime'
    and e.purchase_order_id in (
      select o.id from public.purchase_orders o where o.customer_phone_hash = p_phone_hash and not o.activation_blocked);
  insert into public.auth_events (user_id, kind, at, ip_hash) values (v_uid, 'activated', p_now, p_ip_hash);
  return pg_catalog.jsonb_build_object('ok', true, 'user_id', v_uid);
end $$;

create or replace function app_private.scalev_apply_order(
  p_order_id text, p_order_number text, p_email text, p_phone_hash text, p_buyer_name text,
  p_payment_status text, p_status text, p_amount numeric, p_currency text,
  p_quarantine text, p_items jsonb, p_event_id uuid, p_now timestamptz default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, app_private.server_now());
  v_order public.purchase_orders;
  v_found boolean;
  v_has_ent boolean := false;
  v_quarantine text := p_quarantine;
  v_ent_id uuid;
  v_acct uuid;
begin
  if p_order_id is null or p_order_id = '' then perform app_private.fail('VALIDATION_ERROR', 'order'); end if;
  -- Two workers handling the same order (paid and settled arriving together) take turns.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('scalev_order:' || p_order_id, 0));

  select * into v_order from public.purchase_orders where scalev_order_id = p_order_id for update;
  v_found := found;

  if v_found then
    v_has_ent := exists (
      select 1 from public.access_entitlements e where e.purchase_order_id = v_order.id and e.entitlement_type = 'lifetime');
  end if;
  if v_has_ent and v_quarantine is not null then v_quarantine := 'post_payment_change'; end if;

  -- Defense in depth. The worker already checked all of this; the database refuses to grant on less.
  if v_quarantine is null and not v_has_ent then
    if p_payment_status is null or p_payment_status not in ('paid', 'settled') then
      raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR', detail = 'not_paid';
    end if;
    if p_email is null or p_phone_hash is null then
      raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR', detail = 'email_and_phone';
    end if;
  end if;

  -- An account that already has this email: link only when the order phone matches an order that account already owns
  -- (a repeat purchase, or access that was revoked and bought again). Anything else is not ours to decide: it waits
  -- for CS (needs_cs_review) and no entitlement is made. Never links on the email alone (T9 F4).
  if v_quarantine is null and not v_has_ent then
    select p.user_id into v_acct from public.profiles p where p.email_normalized = p_email;
    if v_acct is not null and not exists (
      select 1 from public.access_entitlements ae join public.purchase_orders po on po.id = ae.purchase_order_id
      where ae.user_id = v_acct and po.customer_phone_hash = p_phone_hash and po.scalev_order_id is distinct from p_order_id
    ) then
      v_quarantine := 'needs_cs_review';
      v_acct := null;
    end if;
  end if;

  if not v_found then
    insert into public.purchase_orders (
      scalev_order_id, scalev_order_number, customer_email_normalized, customer_phone_hash, buyer_name,
      payment_status, scalev_status, amount, currency, verified_via, payment_verified_at, quarantine_reason)
    values (p_order_id, p_order_number, p_email, p_phone_hash, p_buyer_name,
            p_payment_status, p_status, p_amount, coalesce(p_currency, 'IDR'), 'scalev_api', v_now, v_quarantine)
    returning * into v_order;
  elsif v_has_ent then
    -- Access already given: the email and phone proof stay as first verified. Only what Scalev says now is recorded.
    update public.purchase_orders set
      scalev_order_number = coalesce(p_order_number, scalev_order_number),
      payment_status = p_payment_status, scalev_status = p_status, amount = coalesce(p_amount, amount),
      quarantine_reason = v_quarantine
    where id = v_order.id returning * into v_order;
  else
    update public.purchase_orders set
      scalev_order_number = coalesce(p_order_number, scalev_order_number),
      customer_email_normalized = p_email, customer_phone_hash = p_phone_hash, buyer_name = p_buyer_name,
      payment_status = p_payment_status, scalev_status = p_status, amount = coalesce(p_amount, amount),
      currency = coalesce(p_currency, currency), verified_via = 'scalev_api',
      payment_verified_at = coalesce(payment_verified_at, v_now), quarantine_reason = v_quarantine
    where id = v_order.id returning * into v_order;
  end if;

  if not v_has_ent then
    delete from public.purchase_order_items where purchase_order_id = v_order.id;
    insert into public.purchase_order_items (purchase_order_id, variant_id, variant_sku, quantity)
    select v_order.id, x.variant_id, x.variant_sku, greatest(coalesce(x.quantity, 1), 1)
    from pg_catalog.jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(variant_id text, variant_sku text, quantity int);
  end if;

  -- One entitlement per order: paid then settled (or the same event twice) finds it and adds nothing.
  if v_quarantine is null and not v_has_ent then
    insert into public.access_entitlements (email_normalized, purchase_order_id, entitlement_type, status, starts_at, user_id)
    values (p_email, v_order.id, 'lifetime', 'active', v_now, v_acct)
    on conflict (purchase_order_id, entitlement_type) do nothing
    returning id into v_ent_id;
  end if;

  if p_event_id is not null then
    update public.webhook_events set process_status = 'done', processed_at = v_now,
      error_message = case when v_quarantine is not null then 'quarantined:' || v_quarantine else null end
    where id = p_event_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'order_id', v_order.id, 'entitlement_created', v_ent_id is not null,
    'entitlement_exists', v_has_ent or v_ent_id is not null, 'quarantine_reason', v_quarantine);
end $$;

-- ---------- F6: reset by the buyer never touches an account that holds an admin role ----------
create or replace function app_private.reset_password_self(p_email text, p_phone_hash text, p_new_hash text, p_ip_hash text, p_now timestamptz)
returns jsonb
language plpgsql set search_path = '' as $$
declare v_uid uuid; v_matched boolean;
begin
  if p_email is null or p_phone_hash is null or p_new_hash is null then return pg_catalog.jsonb_build_object('ok', false); end if;
  v_matched := exists (select 1 from public.purchase_orders o
                       where o.customer_email_normalized = p_email and o.customer_phone_hash = p_phone_hash
                         and not o.activation_blocked);
  select p.user_id into v_uid
  from public.profiles p join public.auth_credentials c on c.user_id = p.user_id
  where p.email_normalized = p_email
  for update of c;
  if v_uid is null then return pg_catalog.jsonb_build_object('ok', false, 'matched', v_matched); end if;
  -- Admin and staff accounts get a reset link from an admin (audited), never the buyer path.
  if exists (select 1 from public.user_roles r where r.user_id = v_uid) then
    return pg_catalog.jsonb_build_object('ok', false);
  end if;
  if not exists (
    select 1 from public.access_entitlements e join public.purchase_orders o on o.id = e.purchase_order_id
    where e.user_id = v_uid and o.customer_phone_hash = p_phone_hash and not o.activation_blocked
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'matched', v_matched);
  end if;
  update public.auth_credentials set password_hash = p_new_hash, password_changed_at = p_now where user_id = v_uid;
  update public.user_devices set revoked_at = p_now where user_id = v_uid and revoked_at is null;
  delete from public.pending_logins where user_id = v_uid and used_at is null;
  update public.auth_tokens set revoked_at = p_now where user_id = v_uid and used_at is null and revoked_at is null;
  insert into public.auth_events (user_id, kind, at, ip_hash) values (v_uid, 'reset_self', p_now, p_ip_hash);
  return pg_catalog.jsonb_build_object('ok', true, 'user_id', v_uid);
end $$;

-- First enrolment only inside 24 hours of the role grant (PROVISIONAL). After that a super_admin resets the factor
-- (admin_mfa_reset), which opens a new window. Someone who merely signed in to an account that was given a role later
-- cannot enrol their own authenticator.
create or replace function app_private.admin_mfa_begin(p_uid uuid, p_secret_enc text, p_now timestamptz) returns void
language plpgsql set search_path = '' as $$
declare v_since timestamptz;
begin
  select pg_catalog.max(r.granted_at) into v_since from public.user_roles r where r.user_id = p_uid;
  if v_since is null then
    perform app_private.fail('FORBIDDEN');
  end if;
  if exists (select 1 from public.admin_mfa_factors f where f.user_id = p_uid and f.verified_at is not null) then
    perform app_private.fail('CONFLICT', '{"reason":"mfa_already_set"}');
  end if;
  if p_now - v_since > interval '24 hours' then
    perform app_private.fail('FORBIDDEN', '{"reason":"mfa_enrol_window_closed"}');
  end if;
  insert into public.admin_mfa_factors (user_id, secret_enc, created_at, verified_at, last_used_step)
  values (p_uid, p_secret_enc, p_now, null, 0)
  on conflict (user_id) do update set secret_enc = excluded.secret_enc, created_at = excluded.created_at,
    verified_at = null, last_used_step = 0;
end $$;

-- A reset by a super_admin reopens the enrolment window for the target.
create or replace function app_private.admin_mfa_reset(p_actor uuid, p_roles text[], p_target uuid, p_reason text, p_now timestamptz) returns void
language plpgsql set search_path = '' as $$
declare v_reason text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  if p_actor = p_target then perform app_private.fail('CONFLICT', '{"reason":"cannot_reset_self"}'); end if;
  if not exists (select 1 from public.admin_mfa_factors f where f.user_id = p_target) then perform app_private.fail('NOT_FOUND'); end if;
  delete from public.admin_mfa_factors where user_id = p_target;
  update public.user_roles set granted_at = p_now where user_id = p_target;
  update public.admin_sessions set revoked_at = p_now where user_id = p_target and revoked_at is null;
  perform app_private.admin_audit(p_actor, 'admin_mfa', p_target::text, 'mfa.reset', null, null, v_reason, null, p_now);
end $$;

-- ---------- B: no manual approve; recheck with Scalev instead ----------
drop function if exists app_private.admin_order_approve(uuid, text[], uuid, text, text, timestamptz);
drop function if exists app_private.admin_entitlement_approve(uuid, text[], uuid, text, text, timestamptz);

-- Queues the same worker path a webhook uses: the order is read back from the Scalev API and only that reading can
-- grant access. The admin decides nothing about payment. The event carries no payload (nothing is read from it).
create or replace function app_private.admin_order_recheck(
  p_actor uuid, p_roles text[], p_id uuid, p_reason text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare o public.purchase_orders; v_reason text; v_event text; v_hit jsonb;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  select * into o from public.purchase_orders where id = p_id;
  if o.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if o.scalev_order_id is null then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"order","reason":"no_scalev_order"}');
  end if;
  v_hit := app_private.rate_hit('admin:recheck:' || p_actor::text || ':' || o.id::text, p_now, 900, 5);
  if not (v_hit ->> 'allowed')::boolean then perform app_private.fail('RATE_LIMITED'); end if;
  v_event := 'recheck:' || o.scalev_order_id || ':' || pg_catalog.floor(pg_catalog.date_part('epoch', p_now))::text;
  perform app_private.scalev_ingest_event(v_event, 'payment.received', o.scalev_order_id,
    pg_catalog.jsonb_build_object('source', 'admin_recheck'), '\x00'::bytea, pg_catalog.md5(v_event), true, 'admin_recheck', p_now);
  perform app_private.admin_audit(p_actor, 'order', o.id::text, 'order.recheck_requested', null, null, v_reason, null, p_now);
  return pg_catalog.jsonb_build_object('queued', true);
end $$;
revoke all on function app_private.admin_order_recheck(uuid, text[], uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app_private.admin_order_recheck(uuid, text[], uuid, text, timestamptz) to service_role;

create or replace function app_private.admin_order_detail(p_actor uuid, p_roles text[], p_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare o public.purchase_orders; v_acct uuid; v_active boolean; v_has_ent boolean;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into o from public.purchase_orders where id = p_id;
  if o.id is null then perform app_private.fail('NOT_FOUND'); end if;
  select p.user_id into v_acct from public.profiles p where p.email_normalized = o.customer_email_normalized;
  select exists (select 1 from public.access_entitlements e where e.purchase_order_id = o.id and e.entitlement_type = 'lifetime' and e.status = 'active'),
         exists (select 1 from public.access_entitlements e where e.purchase_order_id = o.id and e.entitlement_type = 'lifetime')
    into v_active, v_has_ent;
  return pg_catalog.jsonb_build_object(
    'order', app_private.admin_order_json(o),
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'variant_id', i.variant_id, 'variant_sku', i.variant_sku, 'quantity', i.quantity) order by i.id)
        from public.purchase_order_items i where i.purchase_order_id = o.id), '[]'::jsonb),
    'entitlements', coalesce((select pg_catalog.jsonb_agg(app_private.admin_entitlement_json(e) order by e.created_at)
        from public.access_entitlements e where e.purchase_order_id = o.id), '[]'::jsonb),
    'account', case when v_acct is null then null else pg_catalog.jsonb_build_object(
        'user_id', v_acct, 'has_password', exists (select 1 from public.auth_credentials c where c.user_id = v_acct)) end,
    -- Scalev events for this order: status and short error code only, never the payload.
    'events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', w.id, 'event_type', w.event_type, 'process_status', w.process_status,
        'error_message', pg_catalog.left(coalesce(w.error_message, ''), 120), 'received_at', app_private.iso(w.received_at))
        order by w.received_at desc)
        from (select * from public.webhook_events x where x.scalev_order_id = o.scalev_order_id
              order by x.received_at desc limit 20) w), '[]'::jsonb),
    -- No active access yet and a Scalev order to read again: an admin may ask the worker to check it once more.
    'can_recheck', o.scalev_order_id is not null and not v_active,
    -- Self activation matches email + phone against this order. Without a phone on file only CS can help.
    'can_self_activate', v_active and o.customer_phone_hash is not null and not o.activation_blocked and v_acct is null
                         and o.verified_via = 'scalev_api' and o.payment_status in ('paid', 'settled'),
    'history', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.occurred_at desc)
        from (select a.id, a.action, a.reason, app_private.iso(a.occurred_at) as occurred_at, app_private.admin_email_of(a.actor_id) as actor_email
              from public.admin_audit_logs a
              where (a.entity_type = 'order' and a.entity_id = o.id::text)
                 or (a.entity_type = 'entitlement' and a.entity_id in (select e.id::text from public.access_entitlements e where e.purchase_order_id = o.id))
              order by a.occurred_at desc limit 30) h), '[]'::jsonb));
end $$;

create or replace function app_private.export_user_data(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.profiles;
begin
  if p_uid is null then perform app_private.fail('UNAUTHENTICATED'); end if;
  select * into p from public.profiles where user_id = p_uid;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  return pg_catalog.jsonb_build_object(
    'format_version', 1,
    'exported_at', app_private.iso(p_now),
    'account', pg_catalog.jsonb_build_object(
      'email', p.email_normalized, 'display_name', p.display_name, 'created_at', app_private.iso(p.created_at),
      'region', (select pg_catalog.jsonb_build_object('id', r.id, 'name', r.city_name, 'timezone', r.timezone)
                 from public.regions r where r.id = p.region_id),
      'manual_schedule', p.manual_schedule, 'program_start_date', p.program_start_date,
      'onboarding_completed', p.onboarding_completed, 'theme_pref', p.theme_pref,
      'quran_font_size', p.quran_font_size, 'dhikr_font_size', p.dhikr_font_size),
    'access', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'status', e.status, 'entitlement_type', e.entitlement_type, 'starts_at', app_private.iso(e.starts_at),
        'expires_at', case when e.expires_at is null then null else app_private.iso(e.expires_at) end) order by e.starts_at)
      from public.access_entitlements e where e.user_id = p_uid), '[]'::jsonb),
    'purchases', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'order_id', o.scalev_order_id, 'payment_status', o.payment_status, 'amount', o.amount, 'currency', o.currency,
        'created_at', app_private.iso(o.created_at),
        'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'product_id', i.product_id, 'variant_id', i.variant_id, 'quantity', i.quantity))
          from public.purchase_order_items i where i.purchase_order_id = o.id), '[]'::jsonb)) order by o.created_at)
      from public.purchase_orders o where o.customer_email_normalized = p.email_normalized), '[]'::jsonb),
    'level_state', (select pg_catalog.jsonb_build_object(
        'current_level', l.current_level,
        'level_1_unlocked_at', case when l.level_1_unlocked_at is null then null else app_private.iso(l.level_1_unlocked_at) end,
        'level_2_unlocked_at', case when l.level_2_unlocked_at is null then null else app_private.iso(l.level_2_unlocked_at) end,
        'level_3_unlocked_at', case when l.level_3_unlocked_at is null then null else app_private.iso(l.level_3_unlocked_at) end,
        'level_2_effective_from', l.level_2_effective_from, 'level_3_effective_from', l.level_3_effective_from,
        'journey_completed_at', case when l.journey_completed_at is null then null else app_private.iso(l.journey_completed_at) end)
      from public.user_level_state l where l.user_id = p_uid),
    'sessions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'session_key', s.fajr_local_date, 'timezone', s.timezone, 'level', s.level_number, 'status', s.status,
        'schedule_source', s.schedule_source,
        'started_at', case when s.started_at is null then null else app_private.iso(s.started_at) end,
        'completed_at', case when s.completed_at is null then null else app_private.iso(s.completed_at) end,
        'closed_at', case when s.closed_at is null then null else app_private.iso(s.closed_at) end,
        'activities', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'key', a.activity_config_snapshot ->> 'activity_key', 'phase', a.phase,
            'title', a.activity_config_snapshot ->> 'title', 'target', a.target_count, 'count', a.actual_count,
            'required', a.required_for_completion, 'status', a.status,
            'completed_at', case when a.completed_at is null then null else app_private.iso(a.completed_at) end,
            'operations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'operation_id', o.client_operation_id, 'type', o.op_type, 'delta', o.delta,
                'resulting_count', o.resulting_count,
                'client_recorded_at', case when o.client_recorded_at is null then null else app_private.iso(o.client_recorded_at) end,
                'applied_at', app_private.iso(o.server_applied_at)) order by o.server_applied_at, o.id)
              from public.counter_operations o where o.session_activity_id = a.id), '[]'::jsonb)
          ) order by a.phase, a.id)
          from public.session_activities a where a.session_id = s.id), '[]'::jsonb)) order by s.fajr_local_date)
      from public.night_sessions s where s.user_id = p_uid), '[]'::jsonb),
    'excused_dates', coalesce((select pg_catalog.jsonb_agg(x.excused_date order by x.excused_date)
      from public.session_excuses x where x.user_id = p_uid), '[]'::jsonb),
    'quran_progress', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'surah', q.surah_number, 'ayah', q.last_verse, 'status', q.status, 'updated_at', app_private.iso(q.updated_at),
        'completed_at', case when q.completed_at is null then null else app_private.iso(q.completed_at) end)
        order by q.surah_number)
      from public.quran_reading_progress q where q.user_id = p_uid), '[]'::jsonb),
    'quran_completions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'session_key', s.fajr_local_date, 'surah', c.surah_number, 'type', c.completion_type,
        'completed_at', app_private.iso(c.completed_at)) order by c.completed_at, c.surah_number)
      from public.session_quran_completions c join public.night_sessions s on s.id = c.session_id
      where c.user_id = p_uid), '[]'::jsonb),
    'notification_preferences', (select app_private.notification_prefs_json(p_uid)),
    'push_subscriptions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', s.id, 'is_active', s.is_active, 'created_at', app_private.iso(s.created_at)) order by s.created_at)
      from public.push_subscriptions s where s.user_id = p_uid), '[]'::jsonb),
    'devices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', d.id, 'label', d.label, 'last_seen_at', app_private.iso(d.last_seen_at),
        'revoked_at', case when d.revoked_at is null then null else app_private.iso(d.revoked_at) end)
        order by d.last_seen_at desc, d.id)
      from public.user_devices d where d.user_id = p_uid), '[]'::jsonb),
    'khatam_targets', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', t.id, 'khatam_count', t.khatam_count, 'start_date', t.start_date, 'timezone', t.timezone,
        'adjustment', t.adjustment, 'created_at', app_private.iso(t.created_at),
        'ended_at', case when t.ended_at is null then null else app_private.iso(t.ended_at) end) order by t.created_at, t.id)
      from public.khatam_targets t where t.user_id = p_uid), '[]'::jsonb),
    'khatam_reads', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'target_id', r.target_id, 'day', r.day, 'prayer', r.prayer, 'pages', r.pages,
        'read_at', app_private.iso(r.read_at)) order by r.target_id, r.day, app_private.khatam_prayer_index(r.prayer))
      from public.khatam_reads r where r.user_id = p_uid), '[]'::jsonb),
    'notifications', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'type', j.notification_type, 'local_date', j.local_schedule_date, 'scheduled_at', app_private.iso(j.scheduled_at),
        'status', j.status) order by j.scheduled_at, j.id)
      from public.notification_jobs j where j.user_id = p_uid), '[]'::jsonb));
end $$;
