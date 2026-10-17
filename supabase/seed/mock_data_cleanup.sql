-- Removes everything inserted by supabase/seed/mock_data.sql (c0ffee00-… IDs, mock centers 9001–9003).
begin;
delete from public.dispatch_ticket_events where ticket_id in (select ticket_id from public.dispatch_tickets
  where source_ref like 'c0ffee00-%' or resident_uid::text like 'c0ffee00-%'
     or assigned_unit_id in (select unit_id from public.rescue_units where unit_name in ('Barangay Rescue 1','Sitio 3 Alpha Team')));
delete from public.dispatch_tickets where source_ref like 'c0ffee00-%' or resident_uid::text like 'c0ffee00-%'
   or assigned_unit_id in (select unit_id from public.rescue_units where unit_name in ('Barangay Rescue 1','Sitio 3 Alpha Team'));
delete from public.rescue_units where unit_name in ('Barangay Rescue 1','Sitio 3 Alpha Team');
delete from public.sos_alerts where alert_id::text like 'c0ffee00-%';
delete from public.missing_person_report_audit where report_id::text like 'c0ffee00-%';
delete from public.missing_person_reports where report_id::text like 'c0ffee00-%'
   or resident_uid::text like 'c0ffee00-%' or matched_resident_uid::text like 'c0ffee00-%';
delete from public.disaster_event_audit where event_id::text like 'c0ffee00-%';
delete from public.disaster_events where event_id::text like 'c0ffee00-%';
delete from public.evacuation_records where record_id::text like 'c0ffee00-%' or resident_uid::text like 'c0ffee00-%';
delete from public.resident_profile_details where resident_uid::text like 'c0ffee00-%';
delete from public.households where household_id::text like 'c0ffee00-%';
delete from public.resident_disabilities where resident_uid::text like 'c0ffee00-%';
delete from public.residents where uid::text like 'c0ffee00-%';
delete from public.users where uid::text like 'c0ffee00-%' and email like '%@mock.prioritycare.test';
delete from public.sitio_shelter_plan_audit where sitio_id in (select sitio_id from public.sitio_shelter_plans
  where primary_center_id in (9001, 9002, 9003) or alternate_center_ids && array[9001, 9002, 9003]);
delete from public.sitio_shelter_plans where primary_center_id in (9001, 9002, 9003) or alternate_center_ids && array[9001, 9002, 9003];
delete from public.evacuation_centers where center_id in (9001, 9002, 9003)
  and not exists (select 1 from public.evacuation_records r where r.evac_center_id = center_id);
commit;
