-- Data for the live e2e run (loaded after the seed by the PGlite adapter). Test emails only.
-- Prayer times for the demo Jakarta region, Fajr 04:30 WIB, around today.
insert into public.prayer_times (region_id, local_date, fajr_at, maghrib_at, provider, fetched_at, valid_until)
select r.id, d::date, ((d::date + time '04:30')::timestamp at time zone 'Asia/Jakarta'),
       ((d::date + time '17:55')::timestamp at time zone 'Asia/Jakarta'), 'e2e', now(), now() + interval '90 days'
from public.regions r,
     generate_series(((now() at time zone 'Asia/Jakarta')::date - 3)::timestamp, ((now() at time zone 'Asia/Jakarta')::date + 60)::timestamp, interval '1 day') d
where r.provider_region_code = 'DEMO-JKT';

insert into public.access_entitlements (email_normalized, status, starts_at)
select e, 'active', now() - interval '1 day'
from unnest(array['live-mobile@ngajigaes.test', 'live-desktop@ngajigaes.test', 'live-out-mobile@ngajigaes.test', 'live-out-desktop@ngajigaes.test',
                      'live-logout-mobile@ngajigaes.test', 'live-logout-desktop@ngajigaes.test', 'live-tick-mobile@ngajigaes.test', 'live-tick-desktop@ngajigaes.test']) e;
insert into public.access_entitlements (email_normalized, status, starts_at)
select e, 'pending_verification', now() - interval '1 day'
from unnest(array['pending-mobile@ngajigaes.test', 'pending-desktop@ngajigaes.test']) e;
