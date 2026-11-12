-- T3b: the prayer-time cache keeps the provider's cross-check result and attribution (U1b: the UI says "Terverifikasi"
-- only for "verified"). The job that fills prayer_times writes them. Rows without a value read as "no cross-check".
alter table public.prayer_times add column if not exists verification text
  check (verification is null or verification in ('verified', 'needs_review', 'unchecked'));
alter table public.prayer_times add column if not exists attribution text;
