-- X8 admin, staff and support tools (SCALEV-AUTH-PLAN §8.4, §8.6; CLAUDE.md auth rules). Safe to run twice. Backend only.
--
-- What this adds, and the rules it keeps in the database:
--   * Staff accounts (`staff_comp`): made by an admin, no order, NO password. The admin never types or sees a password.
--     The staff member gets a one-time reset link (app_private.password_token_issue, X4) and chooses their own.
--   * Staff skip the level gate (all levels open) without any fake progress row, and stay out of every buyer report.
--   * Order tools: approve by hand (verified_via = 'admin_manual'), block or unblock self-activation, check a phone.
--   * Phone numbers are never returned by any admin function. Only a keyed hash is stored (X4-5), and nothing here
--     selects it. A support admin can CHECK a number the buyer says (match yes/no); every check is audited.
--   * Every action writes `admin_audit_logs` in the same transaction.
-- Privacy (PRIV-01): nothing in this file reads worship data per user, and nothing reads excused days at all.

-- ---------- who is staff ----------
-- Any staff_comp entitlement, in any status: a former staff account is still not a buyer, so reports keep excluding it.
create or replace function app_private.is_staff_user(p_uid uuid) returns boolean
language sql stable set search_path = '' as $$
  select p_uid is not null and exists (
    select 1 from public.access_entitlements e where e.user_id = p_uid and e.entitlement_type = 'staff_comp')
$$;

-- Active staff access. Revoking staff_comp closes this at once (status check only: staff_comp never expires).
create or replace function app_private.has_all_levels(p_uid uuid) returns boolean
language sql stable set search_path = '' as $$
  select p_uid is not null and exists (
    select 1 from public.access_entitlements e
    where e.user_id = p_uid and e.entitlement_type = 'staff_comp' and e.status = 'active')
$$;

-- ---------- level gate: staff see every level (PROVISIONAL, DECISIONS X8-3) ----------
-- No user_level_state row is faked and nothing is ever locked. A staff session simply uses level 3 (the full set), and the
-- level screens show every level open. Real progress, if any, is still recorded as it happens.
create or replace function app_private.level_for_session(p_uid uuid, p_key date) returns int
language sql stable set search_path = '' as $$
  select case when app_private.has_all_levels(p_uid) then 3 else coalesce(
    (select case when st.level_3_effective_from <= p_key then 3 when st.level_2_effective_from <= p_key then 2 else 1 end
     from public.user_level_state st where st.user_id = p_uid), 1) end
$$;

create or replace function app_private.level_progress_json(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  st public.user_level_state; v_active date; v_start date; v_cur int; v_l3_done int; v_l3_req int;
  v_all boolean := app_private.has_all_levels(p_uid);
begin
  select * into st from public.user_level_state where user_id = p_uid;
  select p.program_start_date into v_start from public.profiles p where p.user_id = p_uid;
  v_active := app_private.user_active_key(p_uid, p_now);
  v_cur := case when v_active is null then (case when v_all then 3 else 1 end) else app_private.level_for_session(p_uid, v_active) end;
  select count(*) into v_l3_done from public.night_sessions n where n.user_id = p_uid and n.level_number = 3 and n.status = 'completed';
  select l.required_successful_nights into v_l3_req from public.levels l where l.level_number = 3;
  return pg_catalog.jsonb_build_object(
    'current_level', v_cur,
    'levels', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'level', l.level_number,
        'completed', c.n,
        'required', l.required_successful_nights,
        'ratio', least(1.0::float8, c.n::float8 / l.required_successful_nights),
        'unlocked', case when v_all then true else case l.level_number when 1 then true when 2 then st.level_2_effective_from is not null
                    else st.level_3_effective_from is not null end end,
        'is_current', l.level_number = v_cur,
        'effective_from_session_key', case when v_all then v_start else case l.level_number when 1 then v_start when 2 then st.level_2_effective_from
                                      else st.level_3_effective_from end end
      ) order by l.level_number)
      from public.levels l
      cross join lateral (
        select count(*)::int as n from public.night_sessions n
        where n.user_id = p_uid and n.level_number = l.level_number and n.status = 'completed'
      ) c),
    'journey_completed', v_l3_done >= v_l3_req,
    -- Required nights are still provisional until the owner approves them (PRD §30.2).
    'provisional', true);
end $$;

create or replace function app_private.get_current_level(p_uid uuid, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_active date; v_lvl int; st public.user_level_state; v_start date; v_all boolean := app_private.has_all_levels(p_uid);
begin
  perform app_private.require_active(p_uid, p_now);
  v_active := app_private.user_active_key(p_uid, p_now);
  v_lvl := case when v_active is null then (case when v_all then 3 else 1 end) else app_private.level_for_session(p_uid, v_active) end;
  select * into st from public.user_level_state where user_id = p_uid;
  select p.program_start_date into v_start from public.profiles p where p.user_id = p_uid;
  return pg_catalog.jsonb_build_object(
    'level', v_lvl,
    'effective_from_session_key', case when v_all then v_start else case v_lvl when 1 then v_start when 2 then st.level_2_effective_from else st.level_3_effective_from end end);
end $$;

-- ---------- activation also accepts an order an admin approved ----------
-- Same function as X4 (20261116030000) with one change: `verified_via = 'admin_manual'` counts as verified, and its
-- payment status is not re-checked because the admin decided it (reason, reference and audit are on the order). Everything
-- else, email + phone match, one activation per entitlement, the block flag, is unchanged.
create or replace function app_private.activate_account(p_email text, p_phone_hash text, p_password_hash text, p_ip_hash text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ent_id uuid; v_uid uuid;
begin
  if p_email is null or p_phone_hash is null or p_password_hash is null then return pg_catalog.jsonb_build_object('ok', false); end if;
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
    and ((o.verified_via = 'scalev_api' and o.payment_status in ('paid', 'settled')) or o.verified_via = 'admin_manual')
    and not o.activation_blocked
  order by e.created_at
  limit 1
  for update of e;
  if v_ent_id is null then return pg_catalog.jsonb_build_object('ok', false); end if;

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

-- ---------- staff accounts ----------
-- No password is made here. The account has no auth_credentials row, so nobody can sign in until the staff member
-- opens a reset link (issued by the backend right after this call) and chooses a password.
create or replace function app_private.admin_staff_create(
  p_actor uuid, p_roles text[], p_email text, p_display_name text, p_reason text, p_now timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_name text; v_reason text; v_uid uuid; e public.access_entitlements;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  v_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or pg_catalog.char_length(v_email) > 254 then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"email","reason":"invalid"}');
  end if;
  v_name := app_private.admin_text(p_display_name, 60, false, 'display_name');
  -- Same lock as activate_account: a buyer activating this email at the same moment waits for us.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('activate:' || v_email));
  if exists (select 1 from public.profiles pr where pr.email_normalized = v_email)
     or exists (select 1 from auth.users u where u.email = v_email) then
    perform app_private.fail('CONFLICT', '{"reason":"account_exists"}');
  end if;
  -- An email that already has an entitlement (a paid order waiting for its buyer) is not ours to take.
  if exists (select 1 from public.access_entitlements x where x.email_normalized = v_email) then
    perform app_private.fail('CONFLICT', '{"reason":"email_has_entitlement"}');
  end if;
  v_uid := gen_random_uuid();
  insert into auth.users (id, email) values (v_uid, v_email);
  insert into public.profiles (user_id, email_normalized, display_name) values (v_uid, v_email, v_name);
  insert into public.access_entitlements (user_id, email_normalized, entitlement_type, status, starts_at, granted_by)
  values (v_uid, v_email, 'staff_comp', 'active', p_now, p_actor) returning * into e;
  perform app_private.admin_audit(p_actor, 'entitlement', e.id::text, 'staff.created', null,
    app_private.admin_entitlement_json(e), v_reason, null, p_now);
  return pg_catalog.jsonb_build_object('user_id', v_uid, 'entitlement', app_private.admin_entitlement_json(e));
end $$;

create or replace function app_private.admin_staff_revoke(
  p_actor uuid, p_roles text[], p_id uuid, p_reason text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare e public.access_entitlements; v_before jsonb; v_reason text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  select * into e from public.access_entitlements where id = p_id and entitlement_type = 'staff_comp' for update;
  if e.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if e.status = 'revoked' then
    perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', e.status, 'to', 'revoked')::text);
  end if;
  v_before := app_private.admin_entitlement_json(e);
  update public.access_entitlements set status = 'revoked', revoked_at = p_now, revoke_reason = v_reason
  where id = e.id returning * into e;
  perform app_private.admin_audit(p_actor, 'entitlement', e.id::text, 'staff.revoked', v_before,
    app_private.admin_entitlement_json(e), v_reason, null, p_now);
  return app_private.admin_entitlement_json(e);
end $$;

create or replace function app_private.admin_staff_list(p_actor uuid, p_roles text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'entitlement_id', e.id, 'user_id', e.user_id, 'email', e.email_normalized, 'display_name', p.display_name,
      'status', e.status, 'created_at', app_private.iso(e.created_at), 'revoked_at', app_private.iso(e.revoked_at),
      'revoke_reason', e.revoke_reason, 'granted_by_email', app_private.admin_email_of(e.granted_by),
      'has_password', exists (select 1 from public.auth_credentials c where c.user_id = e.user_id))
      order by e.created_at desc)
    from public.access_entitlements e left join public.profiles p on p.user_id = e.user_id
    where e.entitlement_type = 'staff_comp'
  ), '[]'::jsonb);
end $$;

-- ---------- reset link: the checks that come before the token is made ----------
-- The backend creates the token and calls app_private.password_token_issue (X4), which needs a reason and writes the
-- audit row. This runs first so the role, the rate limit and the "who may reset whom" rule live in the database too.
--   * a buyer with no account yet cannot be reset (they activate with email + phone, or CS makes the account);
--   * only a super_admin may issue a link for an account that holds an admin role, so support cannot take over an admin.
create or replace function app_private.admin_reset_precheck(p_actor uuid, p_roles text[], p_target uuid, p_reason text, p_now timestamptz)
returns jsonb
language plpgsql set search_path = '' as $$
declare v_hit jsonb;
begin
  perform app_private.admin_require(p_actor, p_roles);
  perform app_private.admin_reason(p_reason);
  if not exists (select 1 from public.profiles p where p.user_id = p_target) then
    perform app_private.fail('NOT_FOUND', '{"reason":"no_account"}');
  end if;
  if exists (select 1 from public.user_roles r where r.user_id = p_target)
     and not exists (select 1 from public.user_roles r where r.user_id = p_actor and r.role = 'super_admin') then
    perform app_private.fail('FORBIDDEN');
  end if;
  v_hit := app_private.rate_hit('admin:resetlink:' || p_actor::text, p_now, 3600, 10);
  if not (v_hit ->> 'allowed')::boolean then
    perform app_private.fail('RATE_LIMITED', pg_catalog.jsonb_build_object('retry_after_seconds', (v_hit ->> 'retry_after_seconds')::int)::text);
  end if;
  return pg_catalog.jsonb_build_object('email', app_private.admin_email_of(p_target), 'is_staff', app_private.is_staff_user(p_target));
end $$;

-- ---------- orders ----------
create or replace function app_private.admin_order_json(o public.purchase_orders) returns jsonb
language sql stable set search_path = '' as $$
  -- No phone in here, not even the hash: `phone_on_file` only says whether activation can match one.
  select pg_catalog.jsonb_build_object(
    'id', o.id, 'scalev_order_id', o.scalev_order_id, 'scalev_order_number', o.scalev_order_number,
    'email', o.customer_email_normalized, 'buyer_name', o.buyer_name,
    'payment_status', o.payment_status, 'scalev_status', o.scalev_status, 'amount', o.amount, 'currency', o.currency,
    'verified_via', o.verified_via, 'payment_verified_at', app_private.iso(o.payment_verified_at),
    'created_at', app_private.iso(o.created_at), 'quarantine_reason', o.quarantine_reason,
    'activation_blocked', o.activation_blocked, 'phone_on_file', o.customer_phone_hash is not null)
$$;

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
    -- No entitlement yet and an email to give it to: an admin may approve by hand.
    'can_approve', o.customer_email_normalized is not null and not v_active,
    -- Self activation matches email + phone against this order. Without a phone on file only CS can help.
    'can_self_activate', v_active and o.customer_phone_hash is not null and not o.activation_blocked and v_acct is null
                         and ((o.verified_via = 'scalev_api' and o.payment_status in ('paid', 'settled')) or o.verified_via = 'admin_manual'),
    'history', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.occurred_at desc)
        from (select a.id, a.action, a.reason, app_private.iso(a.occurred_at) as occurred_at, app_private.admin_email_of(a.actor_id) as actor_email
              from public.admin_audit_logs a
              where (a.entity_type = 'order' and a.entity_id = o.id::text)
                 or (a.entity_type = 'entitlement' and a.entity_id in (select e.id::text from public.access_entitlements e where e.purchase_order_id = o.id))
              order by a.occurred_at desc limit 30) h), '[]'::jsonb));
end $$;

-- Approve by hand: Scalev did not confirm (or an admin overrides a quarantine) and a person decided. The reference
-- (for example a transfer proof id) is required. `verified_via = 'admin_manual'` makes the Scalev worker leave the order alone.
create or replace function app_private.admin_order_approve(
  p_actor uuid, p_roles text[], p_id uuid, p_reason text, p_ref text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare o public.purchase_orders; e public.access_entitlements; v_before jsonb; v_reason text; v_ref text; v_uid uuid;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  v_ref := app_private.admin_text(p_ref, 200, true, 'approval_reference');
  select * into o from public.purchase_orders where id = p_id for update;
  if o.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if o.customer_email_normalized is null then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"email","reason":"order_email_missing"}');
  end if;
  select * into e from public.access_entitlements x where x.purchase_order_id = o.id and x.entitlement_type = 'lifetime' for update;
  if e.id is not null and e.status <> 'pending_verification' then
    -- active: nothing to approve. suspended or revoked: use the entitlement status endpoint, not a back door here.
    perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', e.status, 'to', 'active')::text);
  end if;
  v_before := app_private.admin_order_json(o);
  select p.user_id into v_uid from public.profiles p where p.email_normalized = o.customer_email_normalized;
  update public.purchase_orders set verified_via = 'admin_manual', payment_verified_at = p_now, quarantine_reason = null
  where id = o.id returning * into o;
  if e.id is null then
    insert into public.access_entitlements (email_normalized, purchase_order_id, entitlement_type, status, starts_at, user_id)
    values (o.customer_email_normalized, o.id, 'lifetime', 'active', p_now, v_uid) returning * into e;
  else
    update public.access_entitlements set status = 'active', user_id = coalesce(user_id, v_uid) where id = e.id returning * into e;
  end if;
  perform app_private.admin_audit(p_actor, 'order', o.id::text, 'order.approved_manual', v_before,
    app_private.admin_order_json(o), v_reason, v_ref, p_now);
  return pg_catalog.jsonb_build_object('order', app_private.admin_order_json(o), 'entitlement', app_private.admin_entitlement_json(e));
end $$;

-- Block or reopen self activation for one order (activate_account and reset_password_self already honour the flag).
create or replace function app_private.admin_order_set_activation_blocked(
  p_actor uuid, p_roles text[], p_id uuid, p_blocked boolean, p_reason text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare o public.purchase_orders; v_before jsonb; v_reason text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  if p_blocked is null then perform app_private.fail('VALIDATION_ERROR', '{"field":"blocked","reason":"required"}'); end if;
  select * into o from public.purchase_orders where id = p_id for update;
  if o.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if o.activation_blocked = p_blocked then
    perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object(
      'from', case when o.activation_blocked then 'blocked' else 'open' end,
      'to', case when p_blocked then 'blocked' else 'open' end)::text);
  end if;
  v_before := app_private.admin_order_json(o);
  update public.purchase_orders set activation_blocked = p_blocked where id = o.id returning * into o;
  perform app_private.admin_audit(p_actor, 'order', o.id::text,
    case when p_blocked then 'order.activation_blocked' else 'order.activation_unblocked' end,
    v_before, app_private.admin_order_json(o), v_reason, null, p_now);
  return app_private.admin_order_json(o);
end $$;

-- Does this number match the order? The backend hashes what the admin typed (the same hashPhone as activation) and passes
-- only the hash. The number is not stored and not logged, and the stored hash never leaves the database.
-- A match is the only thing returned. Every check is audited, and checks are rate limited (no guessing a number).
create or replace function app_private.admin_order_phone_check(
  p_actor uuid, p_roles text[], p_id uuid, p_phone_hash text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare o public.purchase_orders; v_hit jsonb; v_match boolean;
begin
  perform app_private.admin_require(p_actor, p_roles);
  if p_phone_hash is null or pg_catalog.char_length(p_phone_hash) < 32 then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"phone","reason":"invalid"}');
  end if;
  select * into o from public.purchase_orders where id = p_id;
  if o.id is null then perform app_private.fail('NOT_FOUND'); end if;
  v_hit := app_private.rate_hit('admin:phonecheck:' || p_actor::text || ':' || o.id::text, p_now, 900, 5);
  if not (v_hit ->> 'allowed')::boolean then
    perform app_private.fail('RATE_LIMITED', pg_catalog.jsonb_build_object('retry_after_seconds', (v_hit ->> 'retry_after_seconds')::int)::text);
  end if;
  v_match := o.customer_phone_hash is not null and o.customer_phone_hash = p_phone_hash;
  perform app_private.admin_audit(p_actor, 'order', o.id::text, 'order.phone_checked', null,
    pg_catalog.jsonb_build_object('match', v_match, 'phone_on_file', o.customer_phone_hash is not null), null, null, p_now);
  return pg_catalog.jsonb_build_object('match', v_match, 'phone_on_file', o.customer_phone_hash is not null);
end $$;

-- ---------- account detail: add staff flag, password flag and reset link history ----------
create or replace function app_private.admin_user_detail(p_actor uuid, p_roles text[], p_user_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.profiles;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into p from public.profiles where user_id = p_user_id;
  if p.user_id is null then perform app_private.fail('NOT_FOUND'); end if;
  return pg_catalog.jsonb_build_object(
    'user', pg_catalog.jsonb_build_object('user_id', p.user_id, 'email', p.email_normalized, 'display_name', p.display_name,
                                          'created_at', app_private.iso(p.created_at),
                                          'is_staff', app_private.is_staff_user(p.user_id),
                                          'has_password', exists (select 1 from public.auth_credentials c where c.user_id = p.user_id),
                                          'is_admin', exists (select 1 from public.user_roles r where r.user_id = p.user_id)),
    'entitlements', coalesce((select pg_catalog.jsonb_agg(app_private.admin_entitlement_json(e) order by e.created_at desc)
        from public.access_entitlements e where e.user_id = p.user_id or e.email_normalized = p.email_normalized), '[]'::jsonb),
    'orders', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id, 'scalev_order_id', o.scalev_order_id, 'payment_status', o.payment_status, 'verified_via', o.verified_via,
        'quarantine_reason', o.quarantine_reason, 'activation_blocked', o.activation_blocked,
        'created_at', app_private.iso(o.created_at)) order by o.created_at desc)
        from public.purchase_orders o where o.customer_email_normalized = p.email_normalized), '[]'::jsonb),
    'history', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.occurred_at desc)
        from (select a.id, a.action, a.reason, app_private.iso(a.occurred_at) as occurred_at, app_private.admin_email_of(a.actor_id) as actor_email
              from public.admin_audit_logs a
              where (a.entity_type = 'entitlement' and a.entity_id in
                       (select e.id::text from public.access_entitlements e where e.user_id = p.user_id or e.email_normalized = p.email_normalized))
                 or (a.entity_type = 'user' and a.entity_id = p.user_id::text and a.action = 'password_reset_link_created')
              order by a.occurred_at desc limit 20) h), '[]'::jsonb));
end $$;

-- ---------- aggregates: staff are not buyers ----------
-- Same counts as 20261117130000, each one restricted to non-staff accounts. No per-user data, still counts only.
create or replace function app_private.admin_aggregates(p_actor uuid, p_roles text[], p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return pg_catalog.jsonb_build_object(
    'entitlements', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', s.status, 'n', s.n) order by s.status)
                              from (select status, count(*) as n from public.access_entitlements
                                    where entitlement_type <> 'staff_comp' group by status) s), '[]'::jsonb),
    'accounts', (select count(*) from public.profiles p where not app_private.is_staff_user(p.user_id)),
    'onboarding', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', case when onboarding_completed then 'done' else 'not_done' end, 'n', n) order by 1)
                            from (select onboarding_completed, count(*) as n from public.profiles p
                                  where not app_private.is_staff_user(p.user_id) group by onboarding_completed) o), '[]'::jsonb),
    'levels', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', 'level_' || l.current_level, 'n', l.n) order by l.current_level)
                        from (select s.current_level, count(*) as n from public.user_level_state s
                              where app_private.has_active_entitlement(s.user_id, p_now) and not app_private.is_staff_user(s.user_id)
                              group by s.current_level) l), '[]'::jsonb),
    'active_users', (select count(*) from (select distinct e.user_id from public.access_entitlements e
                       where e.user_id is not null and e.status = 'active' and e.entitlement_type <> 'staff_comp'
                         and not app_private.is_staff_user(e.user_id)) u),
    'recent_activity', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', w.key, 'n', w.n) order by w.key)
        from (
          select '7_days' as key, count(*) as n from (
            select co.user_id from public.counter_operations co where co.server_applied_at > p_now - interval '7 days'
            union select sa.user_id from public.session_activities sa where sa.completed_at > p_now - interval '7 days') x
          where not app_private.is_staff_user(x.user_id)
          union all
          select '30_days', count(*) from (
            select co.user_id from public.counter_operations co where co.server_applied_at > p_now - interval '30 days'
            union select sa.user_id from public.session_activities sa where sa.completed_at > p_now - interval '30 days') y
          where not app_private.is_staff_user(y.user_id)
        ) w), '[]'::jsonb),
    'completed_nights', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', b.bucket, 'n', b.n) order by b.ord)
        from (
          select case when c.n = 0 then 1 when c.n < 7 then 2 when c.n < 14 then 3 else 4 end as ord,
                 case when c.n = 0 then '0' when c.n < 7 then '1_6' when c.n < 14 then '7_13' else '14_plus' end as bucket,
                 count(*) as n
          from (select e.user_id, (select count(*) from public.night_sessions ns where ns.user_id = e.user_id and ns.status = 'completed') as n
                from public.access_entitlements e
                where e.user_id is not null and e.status = 'active' and e.entitlement_type <> 'staff_comp'
                  and not app_private.is_staff_user(e.user_id)) c
          group by 1, 2) b), '[]'::jsonb),
    'notifications_7_days', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type', n.notification_type, 'status', n.status, 'n', n.n) order by n.notification_type, n.status)
        from (select notification_type, status, count(*) as n from public.notification_jobs nj
              where nj.scheduled_at > p_now - interval '7 days' and not app_private.is_staff_user(nj.user_id)
              group by notification_type, status) n), '[]'::jsonb));
end $$;

-- ---------- first admin (scripts/admin-grant-role.ts) ----------
-- Runs from the command line, before any admin exists, so there is no actor. It makes an account WITHOUT a password
-- when the email has none (same two inserts as activation and staff creation), then grants one role. The audit row has
-- no actor. A second super_admin needs p_allow_another = true: later roles are granted in /admin by a super_admin.
create or replace function app_private.admin_bootstrap_grant(p_email text, p_role text, p_allow_another boolean, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_created boolean := false; v_granted boolean; v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then perform app_private.fail('VALIDATION_ERROR', '{"field":"email","reason":"invalid"}'); end if;
  if p_role not in ('super_admin', 'content_admin', 'support_admin', 'reporting_admin') then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"role","reason":"unknown_role"}');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('admin-bootstrap'));
  select p.user_id into v_uid from public.profiles p where p.email_normalized = v_email;
  if p_role = 'super_admin' and not coalesce(p_allow_another, false)
     and exists (select 1 from public.user_roles r where r.role = 'super_admin' and r.user_id is distinct from v_uid) then
    perform app_private.fail('CONFLICT', '{"reason":"super_admin_exists"}');
  end if;
  if v_uid is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('activate:' || v_email));
    v_uid := gen_random_uuid();
    insert into auth.users (id, email) values (v_uid, v_email);
    insert into public.profiles (user_id, email_normalized) values (v_uid, v_email);
    v_created := true;
  end if;
  insert into public.user_roles (user_id, role, granted_at) values (v_uid, p_role, p_now) on conflict do nothing;
  v_granted := found;
  if v_granted or v_created then
    perform app_private.admin_audit(null, 'user_role', v_uid::text, 'role.granted', null,
      pg_catalog.jsonb_build_object('role', p_role, 'account_created', v_created), 'bootstrap dari baris perintah', null, p_now);
  end if;
  return pg_catalog.jsonb_build_object('user_id', v_uid, 'created', v_created, 'granted', v_granted,
    'has_password', exists (select 1 from public.auth_credentials c where c.user_id = v_uid));
end $$;

grant execute on all functions in schema app_private to service_role;
