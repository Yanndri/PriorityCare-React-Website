-- Resident cancel closes the linked ticket at any stage (was: only open/assigned).
-- Before this, a ticket that was already en route or on scene stayed open on the
-- responder's phone after the resident cancelled the SOS.
create or replace function public.cancel_my_sos(p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare a public.sos_alerts; t public.dispatch_tickets; label text;
begin
  label := case p_reason when 'self_evacuated' then 'Household self-evacuated'
                         when 'threat_receded' then 'Threat receded, safe at home'
                         when 'accidental' then 'Accidental SOS' end;
  if label is null then raise exception 'Choose why you are cancelling.'; end if;
  update public.sos_alerts set status = 'cancelled', cancel_reason = p_reason,
    closed_at = clock_timestamp(), updated_at = clock_timestamp()
  where resident_uid = auth.uid() and status = 'active'
  returning * into a;
  if not found then raise exception 'You have no active SOS.'; end if;
  for t in select * from public.dispatch_tickets x where x.source = 'sos' and x.source_ref = a.alert_id::text
             and x.status not in ('resolved', 'cancelled') for update loop
    update public.dispatch_tickets set status = 'cancelled', closed_at = clock_timestamp(), closed_by = auth.uid(),
      outcome_note = 'Resident cancelled the SOS: ' || label
    where ticket_id = t.ticket_id;
    insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
    values (t.ticket_id, 'cancelled', t.status, 'cancelled', t.assigned_unit_id,
            'Resident cancelled the SOS: ' || label, auth.uid());
  end loop;
  return public.get_my_sos();
end;
$function$;
