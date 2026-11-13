-- X6: Scalev worker side (SCALEV-AUTH-PLAN §4.3 to §4.8, §8). Safe to run twice. Backend only.
--
-- scalev_apply_order() is the only place an entitlement for a Scalev order is created. The worker calls it after it has
-- read the order back from the Scalev API; it is never called from the webhook request. Inside, one transaction:
--   order row + items + (maybe) one entitlement + the webhook event marked done.
-- The entitlement is `active` with no user. The buyer links it by activating with email + phone (activate_account),
-- so nothing here sends an email or makes an account.

-- ---------- apply a verified order ----------
-- p_quarantine is decided by the worker (unknown variant, no email, no phone, amount, canceled, spam). When it is set,
-- no entitlement is made. When the order already has an entitlement, a problem found later never takes access away:
-- the order is only flagged 'post_payment_change' for an admin to decide (PROVISIONAL Q7).
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
begin
  if p_order_id is null or p_order_id = '' then perform app_private.fail('VALIDATION_ERROR', 'order'); end if;
  -- Two workers handling the same order (paid and settled arriving together) take turns.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('scalev_order:' || p_order_id, 0));

  select * into v_order from public.purchase_orders where scalev_order_id = p_order_id for update;
  v_found := found;

  if v_found and v_order.verified_via = 'admin_manual' then
    -- An admin decided this order by hand. A later read from Scalev does not overwrite that.
    if p_event_id is not null then
      update public.webhook_events set process_status = 'done', processed_at = v_now, error_message = 'admin_manual'
      where id = p_event_id;
    end if;
    return pg_catalog.jsonb_build_object('order_id', v_order.id, 'entitlement_created', false, 'skipped', 'admin_manual');
  end if;

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
    insert into public.access_entitlements (email_normalized, purchase_order_id, entitlement_type, status, starts_at)
    values (p_email, v_order.id, 'lifetime', 'active', v_now)
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

-- An order we gave access to has vanished from Scalev (404 stays 404). Flag it for an admin, never revoke.
create or replace function app_private.scalev_flag_order(p_order_id text, p_reason text, p_event_id uuid, p_now timestamptz default null)
returns boolean
language plpgsql set search_path = '' as $$
declare v_now timestamptz := coalesce(p_now, app_private.server_now()); v_done boolean;
begin
  update public.purchase_orders o set quarantine_reason = p_reason
  where o.scalev_order_id = p_order_id and o.verified_via = 'scalev_api'
    and exists (select 1 from public.access_entitlements e where e.purchase_order_id = o.id);
  v_done := found;
  if p_event_id is not null then
    update public.webhook_events set process_status = 'done', processed_at = v_now,
      error_message = case when v_done then 'flagged:' || p_reason else 'order_not_found' end
    where id = p_event_id;
  end if;
  return v_done;
end $$;

-- ---------- safety net for events nobody is working on ----------
-- 1. An event that is still not verified after p_max_age_days is given up (the admin sees it as failed).
-- 2. An event that is waiting (received for a few minutes, or waiting for payment) and has no job queued or running
--    gets a new job. Covers a job that died, a worker that was down, a queue that was cleaned.
create or replace function app_private.scalev_self_heal(p_now timestamptz default null, p_stale_seconds int default 300, p_max_age_days int default 3)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, app_private.server_now());
  n_failed int; n_requeued int := 0; e record;
begin
  update public.webhook_events set process_status = 'failed', processed_at = v_now, error_message = 'NOT_VERIFIED_IN_3_DAYS'
  where provider = 'scalev' and process_status in ('received', 'awaiting_order_verification')
    and received_at < v_now - pg_catalog.make_interval(days => p_max_age_days);
  get diagnostics n_failed = row_count;

  for e in
    select ev.id, ev.external_event_id from public.webhook_events ev
    where ev.provider = 'scalev'
      and ((ev.process_status = 'received' and ev.received_at < v_now - pg_catalog.make_interval(secs => p_stale_seconds))
           or ev.process_status = 'awaiting_order_verification')
      and not exists (
        select 1 from public.jobs j
        where j.job_type = 'scalev_event' and j.status in ('queued', 'running') and j.payload ->> 'webhook_event_id' = ev.id::text)
    order by ev.received_at
    limit 200
  loop
    if app_private.jobs_enqueue('scalev_event', pg_catalog.jsonb_build_object('webhook_event_id', e.id), v_now,
                                'scalev:evt:' || e.external_event_id || ':heal', 20) is not null then
      n_requeued := n_requeued + 1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('given_up', n_failed, 'requeued', n_requeued);
end $$;

-- ---------- purge ----------
-- The encrypted payload is emptied after the retention (90 days unless the PROVISIONAL setting says otherwise).
-- The row stays: its plain columns hold no name, email or phone.
create or replace function app_private.scalev_purge_payloads(p_now timestamptz default null, p_days int default null) returns int
language plpgsql set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, app_private.server_now());
  v_days int := greatest(coalesce(p_days, (app_private.setting('scalev_payload_retention_days') #>> '{}')::int, 90), 1);
  n int;
begin
  update public.webhook_events set payload_encrypted = null
  where payload_encrypted is not null and received_at < v_now - pg_catalog.make_interval(days => v_days);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- grants: service_role only ----------
revoke all on function app_private.scalev_apply_order(text, text, text, text, text, text, text, numeric, text, text, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.scalev_flag_order(text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.scalev_self_heal(timestamptz, int, int) from public, anon, authenticated;
revoke all on function app_private.scalev_purge_payloads(timestamptz, int) from public, anon, authenticated;
grant execute on function app_private.scalev_apply_order(text, text, text, text, text, text, text, numeric, text, text, jsonb, uuid, timestamptz) to service_role;
grant execute on function app_private.scalev_flag_order(text, text, uuid, timestamptz) to service_role;
grant execute on function app_private.scalev_self_heal(timestamptz, int, int) to service_role;
grant execute on function app_private.scalev_purge_payloads(timestamptz, int) to service_role;
