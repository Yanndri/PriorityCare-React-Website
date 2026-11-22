-- STEP31: Data Mining > Response Time (read-only; no table changes).
-- get_response_times(p_event): one row per rescue ticket the caller may see, with the minutes
-- from the ticket being opened to the FIRST time it reached each step, read from the ticket's
-- status log (dispatch_ticket_events). The website averages these per step and per priority.
-- Scope: barangay admins see tickets of their barangay, the super admin all of Cordova
-- (same staff_can_access_barangay rule as the other report functions).
-- Tickets without an "open" log entry (old imported demo tickets) are left out, since their
-- start time is unknown. p_event = null means every ticket; otherwise one disaster event.
-- Safe to run more than once.

create or replace function public.get_response_times(p_event uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_active_staff() then
    raise exception 'Only staff can see response times.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'ticket_no', t.ticket_no,
        'barangay_id', t.barangay_id,
        'barangay_name', b.barangay_name,
        'event_id', t.event_id,
        'priority', t.priority,
        'status', t.status,
        'opened_at', s.opened_at,
        'to_assigned', s.assigned_min,
        'to_acknowledged', s.acknowledged_min,
        'to_en_route', s.en_route_min,
        'to_on_scene', s.on_scene_min,
        'to_resolved', s.resolved_min)
      order by s.opened_at desc)
    from public.dispatch_tickets t
    left join public.barangays b on b.barangay_id = t.barangay_id
    cross join lateral (
      select min(e.recorded_at) filter (where e.to_status = 'open') opened_at,
             round(extract(epoch from min(e.recorded_at) filter (where e.to_status = 'assigned')
                                    - min(e.recorded_at) filter (where e.to_status = 'open')) / 60.0, 1) assigned_min,
             round(extract(epoch from min(e.recorded_at) filter (where e.to_status = 'acknowledged')
                                    - min(e.recorded_at) filter (where e.to_status = 'open')) / 60.0, 1) acknowledged_min,
             round(extract(epoch from min(e.recorded_at) filter (where e.to_status = 'en_route')
                                    - min(e.recorded_at) filter (where e.to_status = 'open')) / 60.0, 1) en_route_min,
             round(extract(epoch from min(e.recorded_at) filter (where e.to_status = 'on_scene')
                                    - min(e.recorded_at) filter (where e.to_status = 'open')) / 60.0, 1) on_scene_min,
             round(extract(epoch from min(e.recorded_at) filter (where e.to_status = 'resolved')
                                    - min(e.recorded_at) filter (where e.to_status = 'open')) / 60.0, 1) resolved_min
      from public.dispatch_ticket_events e
      where e.ticket_id = t.ticket_id
    ) s
    where s.opened_at is not null
      and (p_event is null or t.event_id = p_event)
      and public.staff_can_access_barangay(t.barangay_id)
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_response_times(uuid) from public, anon;
grant execute on function public.get_response_times(uuid) to authenticated;
