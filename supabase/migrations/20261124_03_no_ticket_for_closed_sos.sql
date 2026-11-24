-- A rescue ticket can only be made for an SOS that is still active. Before this, a "Create ticket"
-- form left open while the resident canceled the SOS still created a ticket (24 Nov test, Rosa).
-- Adds one check to create_dispatch_ticket right after the "SOS alert was not found" check.
do $mig$
declare
  d text := pg_get_functiondef('public.create_dispatch_ticket(integer,uuid,uuid,text,text,text,text,numeric,numeric,text,text,text[],integer)'::regprocedure);
  anchor text := E'    raise exception ''SOS alert was not found in this barangay.'';\n  end if;\n';
  added text := E'  if p_source = ''sos'' and exists (select 1 from public.sos_alerts a\n      where a.alert_id::text = p_source_ref and a.status <> ''active'') then\n    raise exception ''This SOS was canceled or closed. Refresh the list.'';\n  end if;\n';
begin
  if position('This SOS was canceled or closed' in d) > 0 then return; end if; -- already applied
  if position(anchor in d) = 0 then raise exception 'create_dispatch_ticket has changed; update this migration.'; end if;
  execute replace(d, anchor, anchor || added);
end
$mig$;
