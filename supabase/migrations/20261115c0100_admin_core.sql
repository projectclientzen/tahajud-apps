-- T7 admin, part 1: sessions, MFA factors, append-only audit log, roles (PRD v1.2 §18.2, §23, §24.1).
-- Safe to run twice. Everything here is backend only: no grants for anon or authenticated.
--
-- Pattern for every admin function: the caller (TypeScript) passes the actor and the roles the action needs.
-- The function checks the actor really holds one of them (app_private.admin_require). So a bug in the TypeScript
-- permission map cannot, on its own, let a wrong role through (SECURITY-05).

-- ---------- tables ----------
create table if not exists public.admin_mfa_factors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- AES-256-GCM, encrypted by the server with a key derived from SESSION_PEPPER. Never returned by any function.
  secret_enc text not null,
  created_at timestamptz not null default now(),
  -- Null while enrolment is not finished.
  verified_at timestamptz,
  -- Time step of the last accepted code. A code for a step <= this is refused (replay guard).
  last_used_step bigint not null default 0
);

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Bound to the sign-in device. Logging that device out ends the admin session too.
  device_id uuid not null references public.user_devices (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  -- Absolute: 8 hours after MFA, no sliding (PRD §24.1).
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists admin_sessions_user_idx on public.admin_sessions (user_id) where revoked_at is null;

alter table public.admin_mfa_factors enable row level security;
alter table public.admin_sessions enable row level security;
revoke all on public.admin_mfa_factors, public.admin_sessions from anon, authenticated;

-- ---------- audit log: append only, for everyone including the backend and the database owner ----------
create or replace function app_private.admin_audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'AUDIT_IMMUTABLE';
end $$;

drop trigger if exists admin_audit_no_change on public.admin_audit_logs;
create trigger admin_audit_no_change before update or delete on public.admin_audit_logs
  for each row execute function app_private.admin_audit_append_only();
drop trigger if exists admin_audit_no_truncate on public.admin_audit_logs;
create trigger admin_audit_no_truncate before truncate on public.admin_audit_logs
  for each statement execute function app_private.admin_audit_append_only();
revoke update, delete, truncate on public.admin_audit_logs from service_role;

-- ---------- helpers ----------
create or replace function app_private.admin_require(p_actor uuid, p_any_of text[]) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_actor is null or not exists (
    select 1 from public.user_roles r where r.user_id = p_actor and r.role = any (p_any_of)
  ) then
    perform app_private.fail('FORBIDDEN');
  end if;
end $$;

create or replace function app_private.admin_audit(
  p_actor uuid, p_type text, p_id text, p_action text, p_before jsonb, p_after jsonb,
  p_reason text, p_ref text, p_now timestamptz
) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, before, after, reason, approval_reference, occurred_at)
  values (p_actor, p_type, p_id, p_action, p_before, p_after, p_reason, p_ref, p_now)
  returning id into v_id;
  return v_id;
end $$;

-- Arabic script blocks. The CMS never takes Arabic text (CLAUDE.md): owner content only.
create or replace function app_private.has_arabic(p_text text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_text ~ '[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]', false)
$$;

-- Trimmed plain text, or a VALIDATION_ERROR naming the field. Empty becomes null unless required.
create or replace function app_private.admin_text(p_val text, p_max int, p_required boolean, p_field text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(pg_catalog.btrim(coalesce(p_val, '')), '');
begin
  if v is null then
    if p_required then
      perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', p_field, 'reason', 'required')::text);
    end if;
    return null;
  end if;
  if pg_catalog.char_length(v) > p_max then
    perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', p_field, 'reason', 'too_long')::text);
  end if;
  if app_private.has_arabic(v) then
    perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', p_field, 'reason', 'arabic_not_allowed')::text);
  end if;
  if v ~ '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]' then
    perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', p_field, 'reason', 'control_characters')::text);
  end if;
  return v;
end $$;

-- A reason someone can read later. At least 10 characters, so "ok" does not pass.
create or replace function app_private.admin_reason(p_val text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := pg_catalog.btrim(coalesce(p_val, ''));
begin
  if pg_catalog.char_length(v) < 10 then
    perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', 'reason', 'reason', 'too_short')::text);
  end if;
  return app_private.admin_text(v, 500, true, 'reason');
end $$;

create or replace function app_private.admin_email_of(p_uid uuid) returns text
language sql stable set search_path = '' as $$
  select p.email_normalized from public.profiles p where p.user_id = p_uid
$$;

-- ---------- state, sessions, MFA ----------
create or replace function app_private.admin_state(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'roles', coalesce((select pg_catalog.jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id = p_uid), '[]'::jsonb),
    'mfa', case
      when f.user_id is null then 'none'
      when f.verified_at is null then 'pending'
      else 'verified' end)
  from (select 1) x left join public.admin_mfa_factors f on f.user_id = p_uid
$$;

-- Starts (or restarts) enrolment. A finished factor can only be removed by a super_admin (admin_mfa_reset).
create or replace function app_private.admin_mfa_begin(p_uid uuid, p_secret_enc text, p_now timestamptz) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.user_roles r where r.user_id = p_uid) then
    perform app_private.fail('FORBIDDEN');
  end if;
  if exists (select 1 from public.admin_mfa_factors f where f.user_id = p_uid and f.verified_at is not null) then
    perform app_private.fail('CONFLICT', '{"reason":"mfa_already_set"}');
  end if;
  insert into public.admin_mfa_factors (user_id, secret_enc, created_at, verified_at, last_used_step)
  values (p_uid, p_secret_enc, p_now, null, 0)
  on conflict (user_id) do update set secret_enc = excluded.secret_enc, created_at = excluded.created_at,
    verified_at = null, last_used_step = 0;
end $$;

-- For the server only: it needs the encrypted secret to check a code.
create or replace function app_private.admin_mfa_get(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('secret_enc', f.secret_enc, 'verified', f.verified_at is not null,
                                       'last_used_step', f.last_used_step)
  from public.admin_mfa_factors f where f.user_id = p_uid
$$;

-- Accepts a time step once. p_confirm = true finishes enrolment (factor must be pending), false is a sign-in.
create or replace function app_private.admin_mfa_use(p_uid uuid, p_step bigint, p_confirm boolean, p_now timestamptz) returns boolean
language plpgsql set search_path = '' as $$
declare v_n int;
begin
  update public.admin_mfa_factors f
     set last_used_step = p_step, verified_at = case when p_confirm then p_now else f.verified_at end
   where f.user_id = p_uid and f.last_used_step < p_step and ((f.verified_at is null) = p_confirm);
  get diagnostics v_n = row_count;
  if v_n = 1 and p_confirm then
    perform app_private.admin_audit(p_uid, 'admin_mfa', p_uid::text, 'mfa.enrolled', null, null, null, null, p_now);
  end if;
  return v_n = 1;
end $$;

create or replace function app_private.admin_session_create(p_uid uuid, p_device_id uuid, p_token_hash text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid; v_exp timestamptz;
begin
  if not exists (select 1 from public.user_roles r where r.user_id = p_uid) then perform app_private.fail('FORBIDDEN'); end if;
  if not exists (select 1 from public.admin_mfa_factors f where f.user_id = p_uid and f.verified_at is not null) then
    perform app_private.fail('FORBIDDEN');
  end if;
  if not exists (
    select 1 from public.user_devices d join public.device_sessions s on s.device_id = d.id
    where d.id = p_device_id and d.user_id = p_uid and d.revoked_at is null
  ) then
    perform app_private.fail('UNAUTHENTICATED');
  end if;
  update public.admin_sessions set revoked_at = p_now where user_id = p_uid and device_id = p_device_id and revoked_at is null;
  v_exp := p_now + pg_catalog.make_interval(hours => app_private.int_setting('admin_session_hours', 8));
  insert into public.admin_sessions (user_id, device_id, token_hash, created_at, expires_at)
  values (p_uid, p_device_id, p_token_hash, p_now, v_exp) returning id into v_id;
  perform app_private.admin_audit(p_uid, 'admin_session', v_id::text, 'session.started', null, null, null, null, p_now);
  return pg_catalog.jsonb_build_object('session_id', v_id, 'expires_at', app_private.iso(v_exp));
end $$;

-- What an admin cookie means right now. Roles are read fresh on every request, so removing a role takes effect at once.
create or replace function app_private.admin_resolve(p_session_id uuid, p_token_hash text, p_uid uuid, p_device_id uuid, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare s public.admin_sessions; v_roles jsonb;
begin
  select * into s from public.admin_sessions where id = p_session_id and user_id = p_uid and device_id = p_device_id;
  if s.id is null or s.token_hash <> p_token_hash or s.revoked_at is not null then
    return pg_catalog.jsonb_build_object('state', 'none');
  end if;
  if s.expires_at <= p_now then return pg_catalog.jsonb_build_object('state', 'expired'); end if;
  if not exists (select 1 from public.user_devices d where d.id = s.device_id and d.revoked_at is null) then
    return pg_catalog.jsonb_build_object('state', 'none');
  end if;
  if not exists (select 1 from public.admin_mfa_factors f where f.user_id = p_uid and f.verified_at is not null) then
    return pg_catalog.jsonb_build_object('state', 'none');
  end if;
  select coalesce(pg_catalog.jsonb_agg(r.role order by r.role), '[]'::jsonb) into v_roles from public.user_roles r where r.user_id = p_uid;
  if v_roles = '[]'::jsonb then return pg_catalog.jsonb_build_object('state', 'none'); end if;
  return pg_catalog.jsonb_build_object('state', 'ok', 'session_id', s.id, 'roles', v_roles, 'expires_at', app_private.iso(s.expires_at));
end $$;

create or replace function app_private.admin_session_end(p_session_id uuid, p_uid uuid, p_now timestamptz) returns void
language sql set search_path = '' as $$
  update public.admin_sessions set revoked_at = p_now where id = p_session_id and user_id = p_uid and revoked_at is null
$$;

-- ---------- roles (super_admin only) ----------
create or replace function app_private.admin_find_user(p_actor uuid, p_roles text[], p_email text) returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select p.user_id into v from public.profiles p where p.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email));
  if v is null then perform app_private.fail('NOT_FOUND', '{"reason":"user_has_not_signed_in"}'); end if;
  return v;
end $$;

create or replace function app_private.admin_roles_list(p_actor uuid, p_roles text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'user_id', u.user_id, 'email', app_private.admin_email_of(u.user_id), 'roles', u.roles,
      'mfa', case when f.user_id is null then 'none' when f.verified_at is null then 'pending' else 'verified' end,
      'granted_at', app_private.iso(u.first_granted)) order by app_private.admin_email_of(u.user_id))
    from (select r.user_id, pg_catalog.jsonb_agg(r.role order by r.role) as roles, min(r.granted_at) as first_granted
          from public.user_roles r group by r.user_id) u
    left join public.admin_mfa_factors f on f.user_id = u.user_id
  ), '[]'::jsonb);
end $$;

create or replace function app_private.admin_role_grant(p_actor uuid, p_roles text[], p_target uuid, p_role text, p_reason text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare v_reason text; v_before jsonb; v_after jsonb;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  if p_role not in ('super_admin', 'content_admin', 'support_admin', 'reporting_admin') then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"role","reason":"unknown_role"}');
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_target) then perform app_private.fail('NOT_FOUND'); end if;
  v_before := app_private.admin_state(p_target) -> 'roles';
  insert into public.user_roles (user_id, role, granted_by, granted_at) values (p_target, p_role, p_actor, p_now) on conflict do nothing;
  v_after := app_private.admin_state(p_target) -> 'roles';
  perform app_private.admin_audit(p_actor, 'user_role', p_target::text, 'role.granted',
    pg_catalog.jsonb_build_object('roles', v_before), pg_catalog.jsonb_build_object('roles', v_after, 'role', p_role), v_reason, null, p_now);
  return pg_catalog.jsonb_build_object('roles', v_after);
end $$;

create or replace function app_private.admin_role_revoke(p_actor uuid, p_roles text[], p_target uuid, p_role text, p_reason text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare v_reason text; v_before jsonb; v_after jsonb;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  if not exists (select 1 from public.user_roles r where r.user_id = p_target and r.role = p_role) then perform app_private.fail('NOT_FOUND'); end if;
  -- Lock the super_admin rows so two revokes at once cannot remove the last one.
  perform 1 from public.user_roles r where r.role = 'super_admin' for update;
  if p_role = 'super_admin' and (select count(*) from public.user_roles r where r.role = 'super_admin') <= 1 then
    perform app_private.fail('CONFLICT', '{"reason":"last_super_admin"}');
  end if;
  v_before := app_private.admin_state(p_target) -> 'roles';
  delete from public.user_roles where user_id = p_target and role = p_role;
  v_after := app_private.admin_state(p_target) -> 'roles';
  if v_after = '[]'::jsonb then
    -- No role left: the factor and every admin session go with it.
    update public.admin_sessions set revoked_at = p_now where user_id = p_target and revoked_at is null;
    delete from public.admin_mfa_factors where user_id = p_target;
  end if;
  perform app_private.admin_audit(p_actor, 'user_role', p_target::text, 'role.revoked',
    pg_catalog.jsonb_build_object('roles', v_before), pg_catalog.jsonb_build_object('roles', v_after, 'role', p_role), v_reason, null, p_now);
  return pg_catalog.jsonb_build_object('roles', v_after);
end $$;

-- Lost phone: a super_admin removes the factor and the target enrols again at the next sign-in.
create or replace function app_private.admin_mfa_reset(p_actor uuid, p_roles text[], p_target uuid, p_reason text, p_now timestamptz) returns void
language plpgsql set search_path = '' as $$
declare v_reason text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  if p_actor = p_target then perform app_private.fail('CONFLICT', '{"reason":"cannot_reset_self"}'); end if;
  if not exists (select 1 from public.admin_mfa_factors f where f.user_id = p_target) then perform app_private.fail('NOT_FOUND'); end if;
  delete from public.admin_mfa_factors where user_id = p_target;
  update public.admin_sessions set revoked_at = p_now where user_id = p_target and revoked_at is null;
  perform app_private.admin_audit(p_actor, 'admin_mfa', p_target::text, 'mfa.reset', null, null, v_reason, null, p_now);
end $$;

-- ---------- audit log reads ----------
-- p_types null = every entity type (super_admin). Cursor: the occurred_at of the last row of the previous page.
create or replace function app_private.admin_audit_list(
  p_actor uuid, p_roles text[], p_types text[], p_before timestamptz, p_limit int, p_entity_id text
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform app_private.admin_require(p_actor, p_roles);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.occurred_at desc, x.id desc)
    from (
      select a.id, a.entity_type, a.entity_id, a.action, a.before, a.after, a.reason, a.approval_reference,
             app_private.iso(a.occurred_at) as occurred_at, a.actor_id, app_private.admin_email_of(a.actor_id) as actor_email
      from public.admin_audit_logs a
      where (p_types is null or a.entity_type = any (p_types))
        and (p_before is null or a.occurred_at < p_before)
        and (p_entity_id is null or a.entity_id = p_entity_id)
      order by a.occurred_at desc, a.id desc
      limit v_lim
    ) x
  ), '[]'::jsonb);
end $$;

grant execute on all functions in schema app_private to service_role;
grant select, insert, update, delete on public.admin_mfa_factors, public.admin_sessions to service_role;
