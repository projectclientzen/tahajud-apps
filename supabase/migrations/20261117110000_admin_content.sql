-- T7 admin, part 2: content workflow for amalan and notification templates (PRD v1.2 §23.2 to §23.4).
-- Draft -> In Review -> Approved -> Published. The reviewer is never the author. Every version keeps a snapshot.
-- What the CMS can change is decided HERE by a whitelist of keys: titles, descriptions, counter unit, reference text,
-- order, phase, required, target. Arabic text, transliteration, meaning and Qur'an references have no key, and every
-- free text is refused if it contains Arabic script. Owner content stays owner content (CLAUDE.md).
-- Safe to run twice.

alter table public.content_versions
  add column if not exists base_version int,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists change_note text,
  add column if not exists review_note text;

-- One open version per piece of content, so two admins cannot publish over each other.
create unique index if not exists content_versions_one_open_idx
  on public.content_versions (content_type, content_id) where status in ('draft', 'in_review', 'approved');

-- ---------- snapshots ----------
create or replace function app_private.admin_activity_snapshot(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'title', d.title, 'description', d.description, 'counter_unit', d.counter_unit, 'source_reference', d.source_reference,
    'configs', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'config_id', c.id, 'level_number', l.level_number, 'phase', c.phase, 'sequence_order', c.sequence_order,
        'required_for_completion', c.required_for_completion, 'target_count', c.target_count, 'title_override', c.title_override)
        order by l.level_number, c.phase, c.sequence_order)
      from public.level_activity_config c join public.levels l on l.id = c.level_id
      where c.activity_definition_id = d.id), '[]'::jsonb))
  from public.activity_definitions d where d.id = p_id
$$;

create or replace function app_private.admin_template_snapshot(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('category', t.category, 'title', t.title, 'body', t.body)
  from public.notification_templates t where t.id = p_id
$$;

create or replace function app_private.admin_live_snapshot(p_type text, p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case p_type when 'activity' then app_private.admin_activity_snapshot(p_id)
                     when 'notification_template' then app_private.admin_template_snapshot(p_id) end
$$;

-- ---------- validation of one template text ----------
-- Plain text only. The only variables are {nama} and {level} (PRD §15.2, SEC-10).
create or replace function app_private.admin_template_text(p_val text, p_max int, p_field text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := app_private.admin_text(p_val, p_max, true, p_field);
begin
  if v ~ '[<>]' then
    perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', p_field, 'reason', 'html_not_allowed')::text);
  end if;
  if pg_catalog.regexp_replace(v, '\{(nama|level)\}', '', 'g') ~ '[{}]' then
    perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', p_field, 'reason', 'unknown_variable')::text);
  end if;
  return v;
end $$;

create or replace function app_private.admin_template_category(p_val text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_val is null or p_val !~ '^[a-z][a-z0-9_]{1,39}$' then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"category","reason":"invalid"}');
  end if;
  return p_val;
end $$;

-- ---------- apply a patch to a snapshot, key by key ----------
-- Returns the new snapshot, or raises VALIDATION_ERROR. Unknown keys are refused, not ignored.
create or replace function app_private.admin_activity_apply_patch(p_base jsonb, p_patch jsonb, p_type text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_new jsonb := p_base; k text; c jsonb; e jsonb; v_cfgs jsonb := '[]'::jsonb; v_cur jsonb; ek text; n int;
  v_seen text[] := '{}'; v_ids text[];
begin
  if pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"patch","reason":"invalid"}');
  end if;
  for k in select pg_catalog.jsonb_object_keys(p_patch) loop
    if k not in ('title', 'description', 'counter_unit', 'source_reference', 'configs') then
      perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', k, 'reason', 'not_editable')::text);
    end if;
  end loop;
  if p_patch ? 'title' then v_new := v_new || pg_catalog.jsonb_build_object('title', app_private.admin_text(p_patch ->> 'title', 120, true, 'title')); end if;
  if p_patch ? 'description' then v_new := v_new || pg_catalog.jsonb_build_object('description', app_private.admin_text(p_patch ->> 'description', 600, false, 'description')); end if;
  if p_patch ? 'source_reference' then v_new := v_new || pg_catalog.jsonb_build_object('source_reference', app_private.admin_text(p_patch ->> 'source_reference', 300, false, 'source_reference')); end if;
  if p_patch ? 'counter_unit' then
    if p_type <> 'dhikr' then
      perform app_private.fail('VALIDATION_ERROR', '{"field":"counter_unit","reason":"not_applicable"}');
    end if;
    v_new := v_new || pg_catalog.jsonb_build_object('counter_unit', app_private.admin_text(p_patch ->> 'counter_unit', 40, false, 'counter_unit'));
  end if;

  if p_patch ? 'configs' then
    if pg_catalog.jsonb_typeof(p_patch -> 'configs') <> 'array' then
      perform app_private.fail('VALIDATION_ERROR', '{"field":"configs","reason":"invalid"}');
    end if;
    select coalesce(pg_catalog.array_agg(x ->> 'config_id'), '{}') into v_ids from pg_catalog.jsonb_array_elements(p_base -> 'configs') x;
    for e in select value from pg_catalog.jsonb_array_elements(p_patch -> 'configs') loop
      if pg_catalog.jsonb_typeof(e) <> 'object' or not (e ? 'config_id') or not ((e ->> 'config_id') = any (v_ids)) then
        perform app_private.fail('VALIDATION_ERROR', '{"field":"configs","reason":"unknown_config"}');
      end if;
      if (e ->> 'config_id') = any (v_seen) then
        perform app_private.fail('VALIDATION_ERROR', '{"field":"configs","reason":"duplicate_config"}');
      end if;
      v_seen := v_seen || (e ->> 'config_id');
      for ek in select pg_catalog.jsonb_object_keys(e) loop
        if ek not in ('config_id', 'phase', 'sequence_order', 'required_for_completion', 'target_count', 'title_override') then
          perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', 'configs.' || ek, 'reason', 'not_editable')::text);
        end if;
      end loop;
    end loop;
    for c in select value from pg_catalog.jsonb_array_elements(p_base -> 'configs') loop
      v_cur := c;
      select x into e from pg_catalog.jsonb_array_elements(p_patch -> 'configs') x where x ->> 'config_id' = c ->> 'config_id' limit 1;
      if e is not null then
        if e ? 'phase' then
          if (e ->> 'phase') not in ('night', 'fajr', 'post_fajr') then
            perform app_private.fail('VALIDATION_ERROR', '{"field":"phase","reason":"invalid"}');
          end if;
          v_cur := v_cur || pg_catalog.jsonb_build_object('phase', e ->> 'phase');
        end if;
        if e ? 'sequence_order' then
          if pg_catalog.jsonb_typeof(e -> 'sequence_order') <> 'number' or (e ->> 'sequence_order') !~ '^[0-9]{1,3}$' or (e ->> 'sequence_order')::int < 1 then
            perform app_private.fail('VALIDATION_ERROR', '{"field":"sequence_order","reason":"invalid"}');
          end if;
          v_cur := v_cur || pg_catalog.jsonb_build_object('sequence_order', (e ->> 'sequence_order')::int);
        end if;
        if e ? 'required_for_completion' then
          if pg_catalog.jsonb_typeof(e -> 'required_for_completion') <> 'boolean' then
            perform app_private.fail('VALIDATION_ERROR', '{"field":"required_for_completion","reason":"invalid"}');
          end if;
          v_cur := v_cur || pg_catalog.jsonb_build_object('required_for_completion', (e -> 'required_for_completion'));
        end if;
        if e ? 'target_count' then
          -- Whether an activity has a target at all is not editable here: only the number.
          if (c -> 'target_count') = 'null'::jsonb then
            if (e -> 'target_count') <> 'null'::jsonb then
              perform app_private.fail('VALIDATION_ERROR', '{"field":"target_count","reason":"not_applicable"}');
            end if;
          else
            if pg_catalog.jsonb_typeof(e -> 'target_count') <> 'number' or (e ->> 'target_count') !~ '^[0-9]{1,6}$' or (e ->> 'target_count')::int < 1 then
              perform app_private.fail('VALIDATION_ERROR', '{"field":"target_count","reason":"invalid"}');
            end if;
            v_cur := v_cur || pg_catalog.jsonb_build_object('target_count', (e ->> 'target_count')::int);
          end if;
        end if;
        if e ? 'title_override' then
          v_cur := v_cur || pg_catalog.jsonb_build_object('title_override', app_private.admin_text(e ->> 'title_override', 120, false, 'title_override'));
        end if;
      end if;
      v_cfgs := v_cfgs || pg_catalog.jsonb_build_array(v_cur);
    end loop;
    -- Two rows of the same level cannot share a phase.
    select count(*) into n from (
      select (x ->> 'level_number') as lv, (x ->> 'phase') as ph from pg_catalog.jsonb_array_elements(v_cfgs) x
      group by 1, 2 having count(*) > 1) dup;
    if n > 0 then perform app_private.fail('VALIDATION_ERROR', '{"field":"phase","reason":"duplicate_phase"}'); end if;
    v_new := v_new || pg_catalog.jsonb_build_object('configs', v_cfgs);
  end if;
  return v_new;
end $$;

create or replace function app_private.admin_template_apply_patch(p_base jsonb, p_patch jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_new jsonb := p_base; k text;
begin
  if pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    perform app_private.fail('VALIDATION_ERROR', '{"field":"patch","reason":"invalid"}');
  end if;
  for k in select pg_catalog.jsonb_object_keys(p_patch) loop
    if k not in ('category', 'title', 'body') then
      perform app_private.fail('VALIDATION_ERROR', pg_catalog.jsonb_build_object('field', k, 'reason', 'not_editable')::text);
    end if;
  end loop;
  if p_patch ? 'category' then v_new := v_new || pg_catalog.jsonb_build_object('category', app_private.admin_template_category(p_patch ->> 'category')); end if;
  if p_patch ? 'title' then v_new := v_new || pg_catalog.jsonb_build_object('title', app_private.admin_template_text(p_patch ->> 'title', 60, 'title')); end if;
  if p_patch ? 'body' then v_new := v_new || pg_catalog.jsonb_build_object('body', app_private.admin_template_text(p_patch ->> 'body', 240, 'body')); end if;
  return v_new;
end $$;

-- ---------- lists and details ----------
create or replace function app_private.admin_version_json(v public.content_versions) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', v.id, 'content_type', v.content_type, 'content_id', v.content_id, 'version_number', v.version_number,
    'status', v.status, 'base_version', v.base_version, 'change_note', v.change_note, 'review_note', v.review_note,
    'submitted_by', v.submitted_by, 'submitted_by_email', app_private.admin_email_of(v.submitted_by),
    'reviewer_id', v.reviewer_id, 'reviewer_email', app_private.admin_email_of(v.reviewer_id),
    'created_at', app_private.iso(v.created_at), 'updated_at', app_private.iso(v.updated_at),
    'approved_at', app_private.iso(v.approved_at), 'published_at', app_private.iso(v.published_at))
$$;

create or replace function app_private.admin_activity_list(p_actor uuid, p_roles text[], p_types text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', d.id, 'activity_key', d.activity_key, 'activity_type', d.activity_type, 'title', d.title,
      'review_status', d.review_status, 'published_version', d.published_version,
      'levels', coalesce((select pg_catalog.jsonb_agg(distinct l.level_number order by l.level_number)
                          from public.level_activity_config c join public.levels l on l.id = c.level_id
                          where c.activity_definition_id = d.id), '[]'::jsonb),
      'open_version', (select pg_catalog.jsonb_build_object('id', v.id, 'status', v.status, 'version_number', v.version_number,
                              'submitted_by', v.submitted_by, 'submitted_by_email', app_private.admin_email_of(v.submitted_by))
                       from public.content_versions v
                       where v.content_type = 'activity' and v.content_id = d.id and v.status in ('draft', 'in_review', 'approved'))
    ) order by d.activity_type, d.title)
    from public.activity_definitions d where d.activity_type = any (p_types)
  ), '[]'::jsonb);
end $$;

-- Detail of one activity. The Arabic text is returned for reading only: no function in this file can change it.
create or replace function app_private.admin_activity_detail(p_actor uuid, p_roles text[], p_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare d public.activity_definitions;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into d from public.activity_definitions where id = p_id;
  if d.id is null then perform app_private.fail('NOT_FOUND'); end if;
  return pg_catalog.jsonb_build_object(
    'id', d.id, 'activity_key', d.activity_key, 'activity_type', d.activity_type,
    'arabic_text', d.arabic_text, 'transliteration', d.transliteration, 'meaning', d.meaning,
    'source_classification', d.source_classification, 'review_status', d.review_status, 'published_version', d.published_version,
    'live', app_private.admin_activity_snapshot(d.id),
    'versions', coalesce((select pg_catalog.jsonb_agg(app_private.admin_version_json(v) order by v.version_number desc)
                          from public.content_versions v where v.content_type = 'activity' and v.content_id = d.id), '[]'::jsonb),
    'open_snapshot', (select v.snapshot_json from public.content_versions v
                      where v.content_type = 'activity' and v.content_id = d.id and v.status in ('draft', 'in_review', 'approved')));
end $$;

create or replace function app_private.admin_template_list(p_actor uuid, p_roles text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', t.id, 'category', t.category, 'title', t.title, 'body', t.body, 'is_active', t.is_active,
      'version', t.version, 'review_status', t.review_status,
      'open_version', (select pg_catalog.jsonb_build_object('id', v.id, 'status', v.status, 'version_number', v.version_number,
                              'submitted_by', v.submitted_by, 'submitted_by_email', app_private.admin_email_of(v.submitted_by),
                              'snapshot', v.snapshot_json)
                       from public.content_versions v
                       where v.content_type = 'notification_template' and v.content_id = t.id and v.status in ('draft', 'in_review', 'approved'))
    ) order by t.category, t.title)
    from public.notification_templates t
  ), '[]'::jsonb);
end $$;

create or replace function app_private.admin_template_detail(p_actor uuid, p_roles text[], p_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare t public.notification_templates;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into t from public.notification_templates where id = p_id;
  if t.id is null then perform app_private.fail('NOT_FOUND'); end if;
  return pg_catalog.jsonb_build_object(
    'id', t.id, 'is_active', t.is_active, 'version', t.version, 'review_status', t.review_status,
    'live', app_private.admin_template_snapshot(t.id),
    'versions', coalesce((select pg_catalog.jsonb_agg(app_private.admin_version_json(v) order by v.version_number desc)
                          from public.content_versions v where v.content_type = 'notification_template' and v.content_id = t.id), '[]'::jsonb),
    'open_snapshot', (select v.snapshot_json from public.content_versions v
                      where v.content_type = 'notification_template' and v.content_id = t.id and v.status in ('draft', 'in_review', 'approved')));
end $$;

-- One version with its snapshot and the live snapshot, so the screen can show a diff.
create or replace function app_private.admin_version_get(p_actor uuid, p_roles text[], p_version_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v public.content_versions;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into v from public.content_versions where id = p_version_id;
  if v.id is null then perform app_private.fail('NOT_FOUND'); end if;
  return app_private.admin_version_json(v) || pg_catalog.jsonb_build_object(
    'snapshot', v.snapshot_json, 'live', app_private.admin_live_snapshot(v.content_type, v.content_id));
end $$;

-- ---------- drafts ----------
create or replace function app_private.admin_draft_save(
  p_actor uuid, p_roles text[], p_type text, p_content_id uuid, p_patch jsonb, p_note text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  d public.activity_definitions; t public.notification_templates; v public.content_versions;
  v_live jsonb; v_base jsonb; v_new jsonb; v_note text; v_pub int; v_next int; v_atype text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_note := app_private.admin_text(p_note, 300, false, 'change_note');
  if p_type = 'activity' then
    select * into d from public.activity_definitions where id = p_content_id for update;
    if d.id is null then perform app_private.fail('NOT_FOUND'); end if;
    v_pub := d.published_version; v_atype := d.activity_type;
  elsif p_type = 'notification_template' then
    select * into t from public.notification_templates where id = p_content_id for update;
    if t.id is null then perform app_private.fail('NOT_FOUND'); end if;
    v_pub := t.version;
  else
    perform app_private.fail('VALIDATION_ERROR', '{"field":"content_type","reason":"invalid"}');
  end if;
  v_live := app_private.admin_live_snapshot(p_type, p_content_id);

  select * into v from public.content_versions cv
   where cv.content_type = p_type and cv.content_id = p_content_id and cv.status in ('draft', 'in_review', 'approved') for update;
  if v.id is not null then
    if v.status <> 'draft' then perform app_private.fail('INVALID_TRANSITION', '{"reason":"not_a_draft"}'); end if;
    if v.submitted_by is distinct from p_actor then perform app_private.fail('FORBIDDEN', '{"reason":"draft_owned_by_other"}'); end if;
    v_base := v.snapshot_json;
  else
    v_base := v_live;
  end if;

  if p_type = 'activity' then v_new := app_private.admin_activity_apply_patch(v_base, p_patch, v_atype);
  else v_new := app_private.admin_template_apply_patch(v_base, p_patch);
  end if;

  if v.id is not null then
    update public.content_versions set snapshot_json = v_new, change_note = coalesce(v_note, change_note), updated_at = p_now
     where id = v.id returning * into v;
  else
    select greatest(coalesce(max(cv.version_number), 0), coalesce(v_pub, 0)) + 1 into v_next
      from public.content_versions cv where cv.content_type = p_type and cv.content_id = p_content_id;
    insert into public.content_versions (content_type, content_id, version_number, snapshot_json, status, submitted_by, base_version, change_note, created_at, updated_at)
    values (p_type, p_content_id, v_next, v_new, 'draft', p_actor, v_pub, v_note, p_now, p_now) returning * into v;
  end if;
  perform app_private.admin_audit(p_actor, p_type, p_content_id::text, 'content.draft_saved', v_base, v_new, v_note,
                                  'content_version:' || v.id::text, p_now);
  return app_private.admin_version_json(v);
end $$;

create or replace function app_private.admin_template_create(
  p_actor uuid, p_roles text[], p_category text, p_title text, p_body text, p_now timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare t_id uuid; v public.content_versions; v_snap jsonb;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_snap := pg_catalog.jsonb_build_object(
    'category', app_private.admin_template_category(p_category),
    'title', app_private.admin_template_text(p_title, 60, 'title'),
    'body', app_private.admin_template_text(p_body, 240, 'body'));
  -- The live row exists but is switched off and unpublished until a version is published.
  insert into public.notification_templates (category, title, body, is_active, version, review_status)
  values (v_snap ->> 'category', v_snap ->> 'title', v_snap ->> 'body', false, 0, 'draft') returning id into t_id;
  insert into public.content_versions (content_type, content_id, version_number, snapshot_json, status, submitted_by, base_version, created_at, updated_at)
  values ('notification_template', t_id, 1, v_snap, 'draft', p_actor, 0, p_now, p_now) returning * into v;
  perform app_private.admin_audit(p_actor, 'notification_template', t_id::text, 'content.template_created', null, v_snap, null,
                                  'content_version:' || v.id::text, p_now);
  return pg_catalog.jsonb_build_object('template_id', t_id, 'version', app_private.admin_version_json(v));
end $$;

-- ---------- review transitions ----------
create or replace function app_private.admin_version_submit(p_actor uuid, p_roles text[], p_version_id uuid, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare v public.content_versions;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into v from public.content_versions where id = p_version_id for update;
  if v.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if v.status <> 'draft' then perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', v.status, 'to', 'in_review')::text); end if;
  if v.submitted_by is distinct from p_actor then perform app_private.fail('FORBIDDEN', '{"reason":"draft_owned_by_other"}'); end if;
  if v.snapshot_json = app_private.admin_live_snapshot(v.content_type, v.content_id) and v.base_version is distinct from 0 then
    perform app_private.fail('CONFLICT', '{"reason":"no_changes"}');
  end if;
  update public.content_versions set status = 'in_review', updated_at = p_now where id = v.id returning * into v;
  perform app_private.admin_audit(p_actor, v.content_type, v.content_id::text, 'content.submitted', null, null, v.change_note,
                                  'content_version:' || v.id::text, p_now);
  return app_private.admin_version_json(v);
end $$;

create or replace function app_private.admin_version_approve(p_actor uuid, p_roles text[], p_version_id uuid, p_note text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare v public.content_versions; v_note text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_note := app_private.admin_text(p_note, 300, false, 'review_note');
  select * into v from public.content_versions where id = p_version_id for update;
  if v.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if v.status <> 'in_review' then perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', v.status, 'to', 'approved')::text); end if;
  -- Four eyes (PRD §23.3). The table has a check for it too.
  if v.submitted_by is not distinct from p_actor then perform app_private.fail('FOUR_EYES_REQUIRED'); end if;
  update public.content_versions set status = 'approved', reviewer_id = p_actor, approved_at = p_now, review_note = v_note, updated_at = p_now
   where id = v.id returning * into v;
  perform app_private.admin_audit(p_actor, v.content_type, v.content_id::text, 'content.approved', null, null, v_note,
                                  'content_version:' || v.id::text, p_now);
  return app_private.admin_version_json(v);
end $$;

-- Back to draft. The author may withdraw. A reviewer sends it back with a note the author can read.
create or replace function app_private.admin_version_return(p_actor uuid, p_roles text[], p_version_id uuid, p_note text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare v public.content_versions; v_note text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into v from public.content_versions where id = p_version_id for update;
  if v.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if v.status not in ('in_review', 'approved') then perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', v.status, 'to', 'draft')::text); end if;
  if v.submitted_by is distinct from p_actor then
    v_note := app_private.admin_text(p_note, 300, true, 'review_note');
  else
    v_note := app_private.admin_text(p_note, 300, false, 'review_note');
  end if;
  update public.content_versions set status = 'draft', reviewer_id = null, approved_at = null, review_note = v_note, updated_at = p_now
   where id = v.id returning * into v;
  perform app_private.admin_audit(p_actor, v.content_type, v.content_id::text, 'content.returned', null, null, v_note,
                                  'content_version:' || v.id::text, p_now);
  return app_private.admin_version_json(v);
end $$;

create or replace function app_private.admin_version_publish(p_actor uuid, p_roles text[], p_version_id uuid, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v public.content_versions; d public.activity_definitions; t public.notification_templates;
  v_before jsonb; c jsonb;
begin
  perform app_private.admin_require(p_actor, p_roles);
  select * into v from public.content_versions where id = p_version_id for update;
  if v.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if v.status <> 'approved' then perform app_private.fail('INVALID_TRANSITION', pg_catalog.jsonb_build_object('from', v.status, 'to', 'published')::text); end if;
  if v.reviewer_id is null or v.reviewer_id is not distinct from v.submitted_by then perform app_private.fail('FOUR_EYES_REQUIRED'); end if;
  v_before := app_private.admin_live_snapshot(v.content_type, v.content_id);

  if v.content_type = 'activity' then
    select * into d from public.activity_definitions where id = v.content_id for update;
    if d.id is null then perform app_private.fail('NOT_FOUND'); end if;
    if v.base_version is distinct from d.published_version then perform app_private.fail('CONFLICT', '{"reason":"stale_draft"}'); end if;
    update public.activity_definitions set
      title = v.snapshot_json ->> 'title', description = v.snapshot_json ->> 'description',
      source_reference = v.snapshot_json ->> 'source_reference',
      counter_unit = case when d.activity_type = 'dhikr' then v.snapshot_json ->> 'counter_unit' else d.counter_unit end,
      review_status = 'published', published_version = v.version_number
    where id = d.id;
    -- Only the rows that changed move to a new config_version. Sessions already started keep their own copy (PRD §23.2).
    for c in select value from pg_catalog.jsonb_array_elements(v.snapshot_json -> 'configs') loop
      update public.level_activity_config g set
        phase = c ->> 'phase', sequence_order = (c ->> 'sequence_order')::int,
        required_for_completion = (c ->> 'required_for_completion')::boolean,
        target_count = (c ->> 'target_count')::int, title_override = c ->> 'title_override',
        config_version = g.config_version + 1
      where g.id = (c ->> 'config_id')::uuid and g.activity_definition_id = d.id
        and (g.phase, g.sequence_order, g.required_for_completion, g.target_count, g.title_override)
            is distinct from (c ->> 'phase', (c ->> 'sequence_order')::int, (c ->> 'required_for_completion')::boolean,
                              (c ->> 'target_count')::int, c ->> 'title_override');
    end loop;
  elsif v.content_type = 'notification_template' then
    select * into t from public.notification_templates where id = v.content_id for update;
    if t.id is null then perform app_private.fail('NOT_FOUND'); end if;
    if v.base_version is distinct from t.version then perform app_private.fail('CONFLICT', '{"reason":"stale_draft"}'); end if;
    update public.notification_templates set
      category = v.snapshot_json ->> 'category', title = v.snapshot_json ->> 'title', body = v.snapshot_json ->> 'body',
      version = v.version_number, review_status = 'published', approved_at = p_now,
      -- A first publish turns the template on. Later publishes keep whatever an admin chose.
      is_active = case when v.base_version = 0 then true else t.is_active end
    where id = t.id;
  else
    perform app_private.fail('VALIDATION_ERROR', '{"field":"content_type","reason":"invalid"}');
  end if;

  update public.content_versions set status = 'published', published_at = p_now, updated_at = p_now where id = v.id returning * into v;
  perform app_private.admin_audit(p_actor, v.content_type, v.content_id::text, 'content.published', v_before, v.snapshot_json,
                                  v.review_note, 'content_version:' || v.id::text, p_now);
  return app_private.admin_version_json(v);
end $$;

create or replace function app_private.admin_template_set_active(p_actor uuid, p_roles text[], p_id uuid, p_active boolean, p_reason text, p_now timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare t public.notification_templates; v_reason text;
begin
  perform app_private.admin_require(p_actor, p_roles);
  v_reason := app_private.admin_reason(p_reason);
  select * into t from public.notification_templates where id = p_id for update;
  if t.id is null then perform app_private.fail('NOT_FOUND'); end if;
  if p_active and t.review_status <> 'published' then perform app_private.fail('CONFLICT', '{"reason":"not_published"}'); end if;
  if t.is_active = p_active then return pg_catalog.jsonb_build_object('is_active', t.is_active); end if;
  update public.notification_templates set is_active = p_active where id = t.id;
  perform app_private.admin_audit(p_actor, 'notification_template', t.id::text, case when p_active then 'template.activated' else 'template.deactivated' end,
    pg_catalog.jsonb_build_object('is_active', t.is_active), pg_catalog.jsonb_build_object('is_active', p_active), v_reason, null, p_now);
  return pg_catalog.jsonb_build_object('is_active', p_active);
end $$;

-- ---------- read-only overviews ----------
create or replace function app_private.admin_levels_overview(p_actor uuid, p_roles text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'level_number', l.level_number, 'title', l.title, 'description', l.description,
      'required_successful_nights', l.required_successful_nights, 'suggested_period_nights', l.suggested_period_nights,
      'estimated_duration_minutes', l.estimated_duration_minutes, 'provisional', l.provisional, 'is_active', l.is_active,
      'activities', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', d.id, 'title', coalesce(c.title_override, d.title), 'activity_type', d.activity_type, 'phase', c.phase,
          'sequence_order', c.sequence_order, 'required_for_completion', c.required_for_completion,
          'target_count', c.target_count, 'provisional', c.provisional, 'config_version', c.config_version)
          order by c.phase, c.sequence_order)
        from public.level_activity_config c join public.activity_definitions d on d.id = c.activity_definition_id
        where c.level_id = l.id and c.is_active), '[]'::jsonb)) order by l.level_number)
    from public.levels l
  ), '[]'::jsonb);
end $$;

-- Metadata only. The verse text column is never selected here.
create or replace function app_private.admin_quran_overview(p_actor uuid, p_roles text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return pg_catalog.jsonb_build_object(
    'sources', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', s.id, 'name', s.name, 'version', s.version, 'file_sha256', s.file_sha256, 'license_text', s.license_text,
        'attribution', s.attribution, 'imported_at', app_private.iso(s.imported_at)) order by s.imported_at desc)
      from public.quran_sources s), '[]'::jsonb),
    'surahs_loaded', (select count(*) from public.quran_surahs),
    'verses_loaded', (select count(*) from public.quran_verses),
    'verses_expected', (select coalesce(sum(verse_count), 0) from public.quran_surahs),
    'translations_loaded', (select count(*) from public.quran_translations));
end $$;

grant execute on all functions in schema app_private to service_role;
