-- T7 admin, part 3: support tools (search, orders, entitlements) and health reads (PRD v1.2 §23.1, §23.5).
-- Privacy (PRIV-01, §18.2): nothing in this file reads worship data. No night session, no counter, no excuse.
-- A support admin sees account, email, order and entitlement. Nothing else. A test greps this file for it.
-- Safe to run twice.

create or replace function app_private.admin_mask_email(p_email text) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2)
$$;

create or replace function app_private.admin_like(p_q text) returns text
language sql immutable set search_path = '' as $$
  select '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.lower(pg_catalog.btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

create or replace function app_private.admin_entitlement_json(e public.access_entitlements) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', e.id, 'email', e.email_normalized, 'status', e.status, 'entitlement_type', e.entitlement_type,
    'user_id', e.user_id, 'has_account', exists (select 1 from public.profiles p where p.email_normalized = e.email_normalized),
    'starts_at', app_private.iso(e.starts_at), 'expires_at', app_private.iso(e.expires_at),
    'revoked_at', app_private.iso(e.revoked_at), 'revoke_reason', e.revoke_reason,
    'transferred_from_email', e.transferred_from_email, 'created_at', app_private.iso(e.created_at),
    'order', (select pg_catalog.jsonb_build_object('id', o.id, 'scalev_order_id', o.scalev_order_id,
                'payment_status', o.payment_status, 'verified_via', o.verified_via)
              from public.purchase_orders o where o.id = e.purchase_order_id))
$$;

-- ---------- search ----------
create or replace function app_private.admin_search(p_actor uuid, p_roles text[], p_q text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_q text := pg_catalog.btrim(coalesce(p_q, '')); v_like text; v_uuid uuid;
begin
  perform app_private.admin_require(p_actor, p_roles);
  if pg_catalog.char_length(v_q) < 3 or pg_catalog.char_length(v_q) > 120 then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"q","reason":"length"}');
  end if;
  v_like := app_private.admin_like(v_q);
  v_uuid := case when v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_q::uuid end;
  return pg_catalog.jsonb_build_object(
    'users', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', p.user_id, 'email', p.email_normalized, 'display_name', p.display_name, 'created_at', app_private.iso(p.created_at))
        order by p.email_normalized)
      from (select * from public.profiles x where x.email_normalized like v_like escape '\' or x.user_id = v_uuid
            order by x.email_normalized limit 25) p), '[]'::jsonb),
    'entitlements', coalesce((select pg_catalog.jsonb_agg(app_private.admin_entitlement_json(e) order by e.created_at desc)
      from (select * from public.access_entitlements x where x.email_normalized like v_like escape '\' or x.id = v_uuid
            order by x.created_at desc limit 25) e), '[]'::jsonb),
    'orders', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id, 'scalev_order_id', o.scalev_order_id, 'email', o.customer_email_normalized, 'buyer_name', o.buyer_name,
        'payment_status', o.payment_status, 'verified_via', o.verified_via, 'created_at', app_private.iso(o.created_at))
        order by o.created_at desc)
      from (select * from public.purchase_orders x
            where x.scalev_order_id = v_q or x.customer_email_normalized like v_like escape '\' or x.id = v_uuid
            order by x.created_at desc limit 25) o), '[]'::jsonb));
end $$;

-- Account basics only: no sessions, no progress, no level, no devices' activity.
create or replace function app_private.admin_user_detail(p_actor uuid, p_roles text[], p_user_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.profiles;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into p from public.profiles where user_id = p_user_id;
  if p.user_id is null then perform app_private.fail('NOT_FOUND'); end if;
  return pg_catalog.jsonb_build_object(
    'user', pg_catalog.jsonb_build_object('user_id', p.user_id, 'email', p.email_normalized, 'display_name', p.display_name,
                                          'created_at', app_private.iso(p.created_at)),
    'entitlements', coalesce((select pg_catalog.jsonb_agg(app_private.admin_entitlement_json(e) order by e.created_at desc)
        from public.access_entitlements e where e.user_id = p.user_id or e.email_normalized = p.email_normalized), '[]'::jsonb),
    'orders', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id, 'scalev_order_id', o.scalev_order_id, 'payment_status', o.payment_status, 'verified_via', o.verified_via,
        'created_at', app_private.iso(o.created_at)) order by o.created_at desc)
        from public.purchase_orders o where o.customer_email_normalized = p.email_normalized), '[]'::jsonb),
    'history', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.occurred_at desc)
        from (select a.id, a.action, a.reason, app_private.iso(a.occurred_at) as occurred_at, app_private.admin_email_of(a.actor_id) as actor_email
              from public.admin_audit_logs a
              where a.entity_type = 'entitlement' and a.entity_id in
                (select e.id::text from public.access_entitlements e where e.user_id = p.user_id or e.email_normalized = p.email_normalized)
              order by a.occurred_at desc limit 20) h), '[]'::jsonb));
end $$;

-- ---------- lists ----------
create or replace function app_private.admin_orders_list(p_actor uuid, p_roles text[], p_filter text, p_limit int, p_offset int) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_lim int := least(greatest(coalesce(p_limit, 25), 1), 100); v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform app_private.admin_require(p_actor, p_roles);
  if p_filter not in ('all', 'pending') then perform app_private.fail('VALIDATION_ERROR', '{"field":"filter","reason":"invalid"}'); end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', o.id, 'scalev_order_id', o.scalev_order_id, 'email', o.customer_email_normalized, 'buyer_name', o.buyer_name,
      'payment_status', o.payment_status, 'amount', o.amount, 'currency', o.currency, 'verified_via', o.verified_via,
      'payment_verified_at', app_private.iso(o.payment_verified_at), 'created_at', app_private.iso(o.created_at),
      'entitlement', (select pg_catalog.jsonb_build_object('id', e.id, 'status', e.status) from public.access_entitlements e where e.purchase_order_id = o.id limit 1))
      order by o.created_at desc)
    from (select * from public.purchase_orders x
          where p_filter = 'all' or exists (select 1 from public.access_entitlements e where e.purchase_order_id = x.id and e.status = 'pending_verification')
          order by x.created_at desc limit v_lim offset v_off) o
  ), '[]'::jsonb);
end $$;

create or replace function app_private.admin_entitlements_list(p_actor uuid, p_roles text[], p_status text, p_limit int, p_offset int) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_lim int := least(greatest(coalesce(p_limit, 25), 1), 100); v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform app_private.admin_require(p_actor, p_roles);
  if p_status not in ('all', 'pending_verification', 'active', 'suspended', 'revoked', 'expired') then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"status","reason":"invalid"}');
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(app_private.admin_entitlement_json(e) order by e.created_at desc)
    from (select * from public.access_entitlements x where p_status = 'all' or x.status = p_status
          order by x.created_at desc limit v_lim offset v_off) e
  ), '[]'::jsonb);
end $$;

-- ---------- entitlement changes ----------
create or replace function app_private.admin_queue_email(p_to text, p_template text, p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.email_outbox (to_email, template_key, payload, status) values (p_to, p_template, p_payload, 'queued') returning id into v_id;
  -- The job carries only the outbox id, so no address sits in a job payload. A worker (T6) sends it.
  insert into public.jobs (job_type, payload) values ('send_email', pg_catalog.jsonb_build_object('outbox_id', v_id));
  return v_id;
end $$;

create or replace function app_private.admin_entitlement_approve(
  p_actor uuid, p_roles text[], p_id uuid, p_reason text, p_ref text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare e public.access_entitlements; v_before jsonb; v_reason text; v_ref text; v_uid uuid;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  v_ref := app_private.admin_text(p_ref, 200, true, 'approval_reference');
  select * into e from public.access_entitlements where id = p_id for update;
  if e.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if e.status <> 'pending_verification' then
    perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', e.status, 'to', 'active')::text);
  end if;
  v_before := app_private.admin_entitlement_json(e);
  -- An account that already proved its email by OTP can be linked now. Otherwise the next sign-in links it.
  select p.user_id into v_uid from public.profiles p where p.email_normalized = e.email_normalized;
  update public.access_entitlements set status = 'active', user_id = coalesce(user_id, v_uid) where id = e.id returning * into e;
  if e.purchase_order_id is not null then
    update public.purchase_orders set verified_via = 'admin_manual', payment_verified_at = p_now where id = e.purchase_order_id;
  end if;
  perform app_private.admin_audit(p_actor, 'entitlement', e.id::text, 'entitlement.approved_manual', v_before,
                                  app_private.admin_entitlement_json(e), v_reason, v_ref, p_now);
  return app_private.admin_entitlement_json(e);
end $$;

-- suspend, reactivate, revoke. One table of allowed moves.
create or replace function app_private.admin_entitlement_set_status(
  p_actor uuid, p_roles text[], p_id uuid, p_to text, p_reason text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare e public.access_entitlements; v_before jsonb; v_reason text; v_ok boolean;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  select * into e from public.access_entitlements where id = p_id for update;
  if e.id is null then perform app_private.fail('NOT_FOUND'); end if;
  v_ok := (e.status = 'active' and p_to in ('suspended', 'revoked'))
       or (e.status = 'suspended' and p_to in ('active', 'revoked'))
       or (e.status = 'pending_verification' and p_to = 'revoked');
  if not v_ok then
    perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', e.status, 'to', p_to)::text);
  end if;
  v_before := app_private.admin_entitlement_json(e);
  update public.access_entitlements set
    status = p_to,
    revoked_at = case when p_to = 'revoked' then p_now else null end,
    revoke_reason = case when p_to = 'revoked' then v_reason else null end
  where id = e.id returning * into e;
  perform app_private.admin_audit(p_actor, 'entitlement', e.id::text,
    case p_to when 'suspended' then 'entitlement.suspended' when 'revoked' then 'entitlement.revoked' else 'entitlement.reactivated' end,
    v_before, app_private.admin_entitlement_json(e), v_reason, null, p_now);
  return app_private.admin_entitlement_json(e);
end $$;

-- Wrong or mistyped buyer email (PRD §20.4, OPS-03). The new address must have no active access of its own.
create or replace function app_private.admin_entitlement_transfer(
  p_actor uuid, p_roles text[], p_id uuid, p_to_email text, p_reason text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare e public.access_entitlements; v_before jsonb; v_reason text; v_to text; v_new_uid uuid; v_old text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  v_to := pg_catalog.lower(pg_catalog.btrim(coalesce(p_to_email, '')));
  if v_to !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or pg_catalog.char_length(v_to) > 254 then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"to_email","reason":"invalid"}');
  end if;
  select * into e from public.access_entitlements where id = p_id for update;
  if e.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if e.status not in ('active', 'pending_verification') then
    perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', e.status, 'to', 'transferred')::text);
  end if;
  if v_to = e.email_normalized then perform app_private.fail('VALIDATION_ERROR', '{"field":"to_email","reason":"same_email"}'); end if;
  if exists (select 1 from public.access_entitlements x
             where x.email_normalized = v_to and x.status in ('active', 'pending_verification') and x.id <> e.id) then
    perform app_private.fail('CONFLICT', '{"reason":"target_has_access"}');
  end if;
  v_before := app_private.admin_entitlement_json(e);
  v_old := e.email_normalized;
  select p.user_id into v_new_uid from public.profiles p where p.email_normalized = v_to;
  -- The previous owner loses access at once: access follows user_id.
  update public.access_entitlements set email_normalized = v_to, user_id = v_new_uid, transferred_from_email = v_old
   where id = e.id returning * into e;
  perform app_private.admin_queue_email(v_old, 'entitlement_transfer_old', pg_catalog.jsonb_build_object('entitlement_id', e.id, 'counterpart', app_private.admin_mask_email(v_to)));
  perform app_private.admin_queue_email(v_to, 'entitlement_transfer_new', pg_catalog.jsonb_build_object('entitlement_id', e.id, 'counterpart', app_private.admin_mask_email(v_old)));
  perform app_private.admin_audit(p_actor, 'entitlement', e.id::text, 'entitlement.transferred', v_before,
                                  app_private.admin_entitlement_json(e), v_reason, null, p_now);
  return app_private.admin_entitlement_json(e);
end $$;

create or replace function app_private.admin_resend_access_email(p_actor uuid, p_roles text[], p_id uuid, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare e public.access_entitlements; hit jsonb; v_outbox uuid;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into e from public.access_entitlements where id = p_id;
  if e.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if e.status <> 'active' then
    perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', e.status, 'to', 'email_sent')::text);
  end if;
  hit := app_private.rate_hit('admin:resend:' || e.id::text, p_now, 3600, 3);
  if not (hit ->> 'allowed')::boolean then
    perform app_private.fail('RATE_LIMITED', pg_catalog.jsonb_build_object('retry_after_seconds', (hit ->> 'retry_after_seconds')::int)::text);
  end if;
  v_outbox := app_private.admin_queue_email(e.email_normalized, 'access_resend', pg_catalog.jsonb_build_object('entitlement_id', e.id));
  perform app_private.admin_audit(p_actor, 'entitlement', e.id::text, 'entitlement.access_email_queued', null, null, null,
                                  'email_outbox:' || v_outbox::text, p_now);
  return pg_catalog.jsonb_build_object('queued', true);
end $$;

-- ---------- jobs and integration health (no user data) ----------
create or replace function app_private.admin_clean_error(p_text text) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.left(pg_catalog.regexp_replace(coalesce(p_text, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', '[email]', 'g'), 300)
$$;

create or replace function app_private.admin_jobs_overview(p_actor uuid, p_roles text[], p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return pg_catalog.jsonb_build_object(
    'by_status', coalesce((select pg_catalog.jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from public.jobs group by status) s), '{}'::jsonb),
    'by_type', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_type', t.job_type, 'status', t.status, 'n', t.n) order by t.job_type, t.status)
                         from (select job_type, status, count(*) as n from public.jobs group by job_type, status) t), '[]'::jsonb),
    'oldest_overdue_seconds', (select pg_catalog.floor(pg_catalog.date_part('epoch', p_now - min(run_after)))::int
                               from public.jobs where status = 'queued' and run_after < p_now),
    'problems', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', j.id, 'job_type', j.job_type, 'status', j.status, 'attempt_count', j.attempt_count, 'max_attempts', j.max_attempts,
        'last_error', app_private.admin_clean_error(j.last_error), 'run_after', app_private.iso(j.run_after)) order by j.run_after desc)
      from (select * from public.jobs where status in ('failed', 'dead') order by run_after desc limit 50) j), '[]'::jsonb));
end $$;

create or replace function app_private.admin_job_requeue(p_actor uuid, p_roles text[], p_id uuid, p_reason text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare j public.jobs; v_reason text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  select * into j from public.jobs where id = p_id for update;
  if j.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if j.status not in ('failed', 'dead') then
    perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', j.status, 'to', 'queued')::text);
  end if;
  update public.jobs set status = 'queued', attempt_count = 0, run_after = p_now, locked_at = null, locked_by = null, last_error = null where id = j.id;
  perform app_private.admin_audit(p_actor, 'job', j.id::text, 'job.requeued',
    pg_catalog.jsonb_build_object('status', j.status, 'job_type', j.job_type, 'attempt_count', j.attempt_count),
    pg_catalog.jsonb_build_object('status', 'queued'), v_reason, null, p_now);
  return pg_catalog.jsonb_build_object('status', 'queued');
end $$;

-- Counts only. The screens turn them into integration cards and say "no data" when a count is zero.
create or replace function app_private.admin_health(p_actor uuid, p_roles text[], p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_today date := (p_now at time zone 'Asia/Jakarta')::date;
begin
  perform app_private.admin_require(p_actor, p_roles);
  return pg_catalog.jsonb_build_object(
    'jobs', coalesce((select pg_catalog.jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from public.jobs group by status) s), '{}'::jsonb),
    'webhooks', pg_catalog.jsonb_build_object(
      'by_status', coalesce((select pg_catalog.jsonb_object_agg(s.process_status, s.n)
                             from (select process_status, count(*) as n from public.webhook_events where received_at > p_now - interval '7 days' group by process_status) s), '{}'::jsonb),
      'last_received_at', (select app_private.iso(max(received_at)) from public.webhook_events)),
    'entitlements_pending', (select count(*) from public.access_entitlements where status = 'pending_verification'),
    'prayer', pg_catalog.jsonb_build_object(
      'regions_supported', (select count(*) from public.regions where is_supported),
      'covered_today', (select count(distinct region_id) from public.prayer_times where local_date = v_today),
      'covered_3_days', (select count(*) from (select region_id from public.prayer_times
                           where local_date between v_today and v_today + 2 group by region_id having count(distinct local_date) = 3) c),
      'last_fetched_at', (select app_private.iso(max(fetched_at)) from public.prayer_times),
      'needs_review', (select count(*) from public.prayer_times where verification = 'needs_review' and local_date >= v_today),
      'by_provider', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('provider', q.provider, 'rows', q.n, 'last_fetched_at', app_private.iso(q.last_at)) order by q.provider)
                               from (select provider, count(*) as n, max(fetched_at) as last_at from public.prayer_times group by provider) q), '[]'::jsonb),
      'sync_jobs', coalesce((select pg_catalog.jsonb_object_agg(s.status, s.n)
                             from (select status, count(*) as n from public.jobs where job_type = 'prayer_sync' group by status) s), '{}'::jsonb)),
    'push', pg_catalog.jsonb_build_object(
      'subscriptions_active', (select count(*) from public.push_subscriptions where is_active),
      'subscriptions_failing', (select count(*) from public.push_subscriptions where is_active and failure_count > 0),
      'deliveries_24h', coalesce((select pg_catalog.jsonb_object_agg(s.delivery_status, s.n)
                                  from (select delivery_status, count(*) as n from public.notification_deliveries where attempted_at > p_now - interval '24 hours' group by delivery_status) s), '{}'::jsonb)),
    'email', pg_catalog.jsonb_build_object(
      'by_status', coalesce((select pg_catalog.jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from public.email_outbox group by status) s), '{}'::jsonb)),
    'content_in_review', (select count(*) from public.content_versions where status = 'in_review'));
end $$;

grant execute on all functions in schema app_private to service_role;
