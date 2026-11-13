-- T7 admin, part 4: raw counts for the aggregate dashboard (PRD v1.2 §22.5, §23.1, PRIV-01).
-- This function returns COUNTS, never a row per user. The server then merges every group smaller than 20 users
-- before anything reaches a screen (src/server/admin/rules/k-anon.ts). The query touches the status 'completed'
-- only: it has no way to count or split by the berhalangan status, so that data cannot leak from here.
-- Safe to run twice.

create or replace function app_private.admin_aggregates(p_actor uuid, p_roles text[], p_now timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  perform app_private.admin_require(p_actor, p_roles);
  return pg_catalog.jsonb_build_object(
    'entitlements', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', s.status, 'n', s.n) order by s.status)
                              from (select status, count(*) as n from public.access_entitlements group by status) s), '[]'::jsonb),
    'accounts', (select count(*) from public.profiles),
    'onboarding', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', case when onboarding_completed then 'done' else 'not_done' end, 'n', n) order by 1)
                            from (select onboarding_completed, count(*) as n from public.profiles group by onboarding_completed) o), '[]'::jsonb),
    'levels', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', 'level_' || l.current_level, 'n', l.n) order by l.current_level)
                        from (select s.current_level, count(*) as n from public.user_level_state s
                              where app_private.has_active_entitlement(s.user_id, p_now) group by s.current_level) l), '[]'::jsonb),
    'active_users', (select count(*) from (select distinct e.user_id from public.access_entitlements e
                       where e.user_id is not null and e.status = 'active') u),
    'recent_activity', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', w.key, 'n', w.n) order by w.key)
        from (
          select '7_days' as key, count(*) as n from (
            select co.user_id from public.counter_operations co where co.server_applied_at > p_now - interval '7 days'
            union select sa.user_id from public.session_activities sa where sa.completed_at > p_now - interval '7 days') x
          union all
          select '30_days', count(*) from (
            select co.user_id from public.counter_operations co where co.server_applied_at > p_now - interval '30 days'
            union select sa.user_id from public.session_activities sa where sa.completed_at > p_now - interval '30 days') y
        ) w), '[]'::jsonb),
    'completed_nights', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', b.bucket, 'n', b.n) order by b.ord)
        from (
          select case when c.n = 0 then 1 when c.n < 7 then 2 when c.n < 14 then 3 else 4 end as ord,
                 case when c.n = 0 then '0' when c.n < 7 then '1_6' when c.n < 14 then '7_13' else '14_plus' end as bucket,
                 count(*) as n
          from (select e.user_id, (select count(*) from public.night_sessions ns where ns.user_id = e.user_id and ns.status = 'completed') as n
                from public.access_entitlements e where e.user_id is not null and e.status = 'active') c
          group by 1, 2) b), '[]'::jsonb),
    'notifications_7_days', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type', n.notification_type, 'status', n.status, 'n', n.n) order by n.notification_type, n.status)
        from (select notification_type, status, count(*) as n from public.notification_jobs where scheduled_at > p_now - interval '7 days'
              group by notification_type, status) n), '[]'::jsonb));
end $$;

grant execute on all functions in schema app_private to service_role;
