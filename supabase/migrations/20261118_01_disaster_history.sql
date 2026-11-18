-- STEP 27: disaster history in the app (2026-11-18). Ended disasters, newest first, for the
-- "Disasters" switch on the Hazards screens. Residents get their own barangay only; responders
-- and staff get all of Cordova. Read-only. Run in the Supabase SQL Editor. Safe to run twice.

begin;

create or replace function public.get_disaster_history(p_limit integer default 30)
returns table (event_id uuid, name text, hazard_type text, barangay_id integer, barangay_name text,
               location_description text, latitude numeric, longitude numeric,
               started_at timestamptz, resolved_at timestamptz, resolution_reason text)
language sql
stable
security definer
set search_path to ''
as $$
  select e.event_id, e.name, e.hazard_type::text, e.barangay_id, b.barangay_name::text,
         e.location_description, e.latitude, e.longitude, e.started_at, e.resolved_at, e.resolution_reason
    from public.disaster_events e
    join public.barangays b on b.barangay_id = e.barangay_id
   where e.status = 'resolved'
     and exists (select 1 from public.users u where u.uid = auth.uid() and u.account_status = 'active')
     and (public.is_active_rescuer() or public.is_active_staff()
          or e.barangay_id = (select r.barangay_id from public.residents r where r.uid = auth.uid()))
   order by e.resolved_at desc nulls last
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

revoke all on function public.get_disaster_history(integer) from public, anon;
grant execute on function public.get_disaster_history(integer) to authenticated;

commit;
