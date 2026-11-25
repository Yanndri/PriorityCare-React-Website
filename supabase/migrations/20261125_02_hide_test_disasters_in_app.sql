-- Test disasters stay in the staff history on the website but no longer show in the app
-- (resident "has ended" notice, ended-disaster popup, responder Disasters panel).

alter table public.disaster_events
  add column if not exists hidden_in_app boolean not null default false;

comment on column public.disaster_events.hidden_in_app is
  'true = left out of get_disaster_history for residents and responders (test records). Staff still see it.';

create or replace function public.get_disaster_history(p_limit integer default 30)
 returns table(event_id uuid, name text, hazard_type text, barangay_id integer, barangay_name text, location_description text, latitude numeric, longitude numeric, started_at timestamp with time zone, resolved_at timestamp with time zone, resolution_reason text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select e.event_id, e.name, e.hazard_type::text, e.barangay_id, b.barangay_name::text,
         e.location_description, e.latitude, e.longitude, e.started_at, e.resolved_at, e.resolution_reason
    from public.disaster_events e
    join public.barangays b on b.barangay_id = e.barangay_id
   where e.status = 'resolved'
     and (not e.hidden_in_app or public.is_active_staff())
     and exists (select 1 from public.users u where u.uid = auth.uid() and u.account_status = 'active')
     and (public.is_active_rescuer() or public.is_active_staff()
          or e.barangay_id = (select r.barangay_id from public.residents r where r.uid = auth.uid()))
   order by e.resolved_at desc nulls last
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
$function$;

-- The test records from 24 Nov 2026.
update public.disaster_events set hidden_in_app = true
 where event_id in (
   'e10fff69-8145-426d-904e-c767125672e5', -- Earthquake (TEST)
   '8471d970-3c23-4c41-8092-90c918fdf416', -- Test (lapu2)
   'b313d0a3-d0c1-47db-8353-099ea73cfe65', -- Fireman (Him house)
   '2351c317-406e-45b0-b8cc-36d800f5c8cb', -- Flood in Brgy. Ibabao (Squirtle)
   '18f30308-9c7a-4743-92a8-2787d9508cd5'  -- Fire in Brgy. Dapitan (Charizard)
 );
