-- Extra users for the T3c live e2e run (loaded after t3b-fixtures.sql). Test emails only, one per test:
-- a second sign-in for the same address within 60 seconds would hit the resend cooldown.
insert into public.access_entitlements (email_normalized, status, starts_at)
select 't3c-' || k || '-' || p || '@ngajigaes.test', 'active', now() - interval '1 day'
from unnest(array['quran', 'prayer', 'push-a', 'push-b', 'origin', 'del']) k, unnest(array['mobile', 'desktop']) p;
insert into public.access_entitlements (email_normalized, status, starts_at)
select 't3c-lapsed-' || p || '@ngajigaes.test', 'suspended', now() - interval '1 day'
from unnest(array['mobile', 'desktop']) p;
