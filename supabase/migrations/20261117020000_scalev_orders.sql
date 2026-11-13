-- X3: Scalev intake (SCALEV-AUTH-PLAN §3.2, §4.1, §8). Schema for orders that can be quarantined, and the one function
-- the webhook route calls. Safe to run twice. Backend only: nothing here is granted to anon or authenticated.
--
-- The webhook is a trigger, never proof (CLAUDE.md). This migration stores what Scalev sent, encrypted, and queues a job.
-- It never creates an entitlement. That happens in 20261117030000_scalev_provision.sql, after the worker has read the
-- order back from the Scalev API.

-- ---------- webhook_events: which order an event is about ----------
-- UUIDv7 `data.id` of the order (not the display number). The worker reads the order with it.
alter table public.webhook_events add column if not exists scalev_order_id text;
create index if not exists webhook_events_order_idx on public.webhook_events (scalev_order_id) where scalev_order_id is not null;
-- Sweeper self-heal looks for events that nothing is working on.
create index if not exists webhook_events_open_idx on public.webhook_events (process_status, received_at)
  where process_status in ('received', 'awaiting_order_verification');

-- ---------- orders that can be held back ----------
-- An order with no email (or an email we cannot trust) is still recorded, so an admin can see it and decide.
alter table public.purchase_orders alter column customer_email_normalized drop not null;
alter table public.purchase_orders add column if not exists scalev_order_number text;
alter table public.purchase_orders add column if not exists scalev_status text;
alter table public.purchase_orders add column if not exists quarantine_reason text;
alter table public.purchase_orders drop constraint if exists purchase_orders_quarantine_reason_check;
alter table public.purchase_orders add constraint purchase_orders_quarantine_reason_check
  check (quarantine_reason is null or quarantine_reason in (
    'unknown_variant', 'missing_email', 'missing_phone', 'amount_below_min', 'order_canceled', 'spam_flag', 'post_payment_change'
  ));
create index if not exists purchase_orders_quarantine_idx on public.purchase_orders (created_at) where quarantine_reason is not null;

-- We only know the variant (number and SKU) from the order, not the product.
alter table public.purchase_order_items alter column product_id drop not null;
alter table public.purchase_order_items add column if not exists variant_sku text;

-- ---------- retention setting (PROVISIONAL, PRD §24.4) ----------
insert into public.app_settings (key, value, provisional)
values ('scalev_payload_retention_days', '90'::jsonb, true)
on conflict (key) do nothing;

-- ---------- intake ----------
-- One transaction: record the event, and queue the job that will verify the order. A second delivery of the same
-- unique_id does nothing and says so (Scalev sends at least once). Events that are not triggers are kept as `ignored`
-- for audit, with no job. The caller passes the payload already encrypted; nothing here can read it.
create or replace function app_private.scalev_ingest_event(
  p_event_id text, p_event_type text, p_order_id text, p_minimal jsonb, p_encrypted bytea, p_sha256 text,
  p_trigger boolean, p_note text default null, p_now timestamptz default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, app_private.server_now());
  v_id uuid;
begin
  if p_event_id is null or p_event_id = '' or p_event_type is null or p_encrypted is null or p_sha256 is null then
    perform app_private.fail('VALIDATION_ERROR', 'event');
  end if;

  insert into public.webhook_events (provider, external_event_id, event_type, scalev_order_id, payload_minimal,
                                     payload_encrypted, payload_sha256, received_at, process_status, error_message)
  values ('scalev', p_event_id, p_event_type, p_order_id, coalesce(p_minimal, '{}'::jsonb), p_encrypted, p_sha256, v_now,
          case when p_trigger then 'received' else 'ignored' end, p_note)
  on conflict (provider, external_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    return pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  if p_trigger then
    -- 20 tries: the handler schedules its own long retries. This cap only matters for crashes.
    perform app_private.jobs_enqueue('scalev_event', pg_catalog.jsonb_build_object('webhook_event_id', v_id),
                                     v_now, 'scalev:evt:' || p_event_id, 20);
  end if;
  return pg_catalog.jsonb_build_object('duplicate', false, 'id', v_id, 'queued', p_trigger);
end $$;

revoke all on function app_private.scalev_ingest_event(text, text, text, jsonb, bytea, text, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function app_private.scalev_ingest_event(text, text, text, jsonb, bytea, text, boolean, text, timestamptz) to service_role;
