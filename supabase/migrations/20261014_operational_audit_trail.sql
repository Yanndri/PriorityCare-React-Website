-- Evacuation audit trail + combined operational timestamp log.
-- Requires 20261014_disaster_events.sql (assert_disaster_admin), facility lifecycle/registration audits,
-- and 20261014_missing_person_reconciliation.sql. Adds one audit table, one trigger and one read-only RPC.
-- Existing rows are not modified. Edits/deletes of evacuation records are captured only from now on.
begin;

create table if not exists public.evacuation_record_audit (
  audit_id bigint generated always as identity primary key,
  record_id uuid not null,
  resident_uid uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_row jsonb,
  new_row jsonb,
  actor_uid uuid,          -- auth.uid() of the signed-in user; null for service-role / SQL editor changes
  db_role text not null,   -- database role that executed the change
  changed_at timestamptz not null default clock_timestamp()
);
create index if not exists evacuation_record_audit_record on public.evacuation_record_audit(record_id, changed_at);
create index if not exists evacuation_record_audit_time on public.evacuation_record_audit(changed_at);
alter table public.evacuation_record_audit enable row level security;
revoke all on public.evacuation_record_audit from public, anon, authenticated;

create or replace function public.log_evacuation_record_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return null; end if;
  insert into public.evacuation_record_audit(record_id, resident_uid, action, old_row, new_row, actor_uid, db_role)
  values (
    coalesce(new.record_id, old.record_id),
    coalesce(new.resident_uid, old.resident_uid),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    auth.uid(),
    current_user
  );
  return null;
end;
$$;
revoke all on function public.log_evacuation_record_change() from public, anon, authenticated;

create or replace trigger log_evacuation_record_change
  after insert or update or delete on public.evacuation_records
  for each row execute function public.log_evacuation_record_change();

-- Combined, time-ordered log of operational events in the caller's scope.
-- Admins: residents/events/reports of their assigned barangay, plus facility-wide center changes.
-- Super admins: everything.
create or replace function public.get_operational_timeline(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_role text; actor_barangay integer; result jsonb; total integer; events jsonb;
begin
  perform public.assert_disaster_admin();
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from >= p_to then
    raise exception 'Choose a valid date range (start before end).';
  end if;
  if p_to - p_from > interval '366 days' then
    raise exception 'Choose a date range of at most one year.';
  end if;
  select role::text, assigned_barangay_id into actor_role, actor_barangay from public.users where uid = auth.uid();

  with ev(occurred_at, category, action, subject, barangay_id, from_value, to_value, actor_uid, details, ref_id) as (
  -- 1. Evacuation status log (one row per record, with the previous status for that resident).
  (select x.occurred_at, 'evacuation', 'Evacuation status logged', x.resident_name, x.barangay_id,
         x.prev_status, x.evac_status, coalesce(x.entered_by, x.rescuer_uid),
         concat_ws(' · ',
           case when x.center_name is not null then 'Center: ' || x.center_name end,
           case when x.rescuer_uid is not null then 'Rescuer: ' || coalesce(nullif(concat_ws(' ', ru.f_name, ru.l_name), ''), x.rescuer_uid::text) end,
           case when x.evacuated_at is not null then 'Evacuated at ' || to_char(x.evacuated_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') || ' PHT' end,
           case when x.entered_by is null then 'Entered by: not recorded' end),
         x.record_id::text
  from (
    select er.record_id, er.evac_status::text as evac_status, er.evacuated_at, er.rescuer_uid,
           coalesce(er.logged_at, er.evacuated_at) as occurred_at,
           lag(er.evac_status::text) over (partition by er.resident_uid
             order by coalesce(er.logged_at, er.evacuated_at), er.record_id) as prev_status,
           r.barangay_id, concat_ws(' ', u.f_name, u.l_name) as resident_name, c.center_name,
           (select a.actor_uid from public.evacuation_record_audit a
             where a.record_id = er.record_id and a.action = 'INSERT' order by a.changed_at limit 1) as entered_by
    from public.evacuation_records er
    join public.residents r on r.uid = er.resident_uid
    join public.users u on u.uid = r.uid
    left join public.evacuation_centers c on c.center_id = er.evac_center_id
    where actor_role = 'super_admin' or r.barangay_id = actor_barangay
  ) x
  left join public.users ru on ru.uid = x.rescuer_uid
  where x.occurred_at >= p_from and x.occurred_at < p_to)
  union all
  -- 2. Edits and deletions of evacuation records (captured by the trigger).
  (select a.changed_at, 'evacuation_change',
         case a.action when 'UPDATE' then 'Evacuation record edited' else 'Evacuation record deleted' end,
         coalesce(nullif(concat_ws(' ', u.f_name, u.l_name), ''), a.resident_uid::text), r.barangay_id,
         a.old_row->>'evac_status', a.new_row->>'evac_status', a.actor_uid,
         concat_ws(' · ',
           case when a.action = 'UPDATE' then 'Changed: ' || (
             select string_agg(k, ', ' order by k) from jsonb_object_keys(a.new_row) k
             where a.new_row->k is distinct from a.old_row->k) end,
           case when a.actor_uid is null then 'Changed via ' || a.db_role || ' (no signed-in user)' end),
         a.record_id::text
  from public.evacuation_record_audit a
  left join public.residents r on r.uid = a.resident_uid
  left join public.users u on u.uid = a.resident_uid
  where a.action in ('UPDATE','DELETE') and a.changed_at >= p_from and a.changed_at < p_to
    and (actor_role = 'super_admin' or r.barangay_id = actor_barangay))
  union all
  -- 3. Evacuation center status and capacity changes (facility-wide).
  (select f.changed_at, 'facility', 'Center status changed', c.center_name, null,
         f.old_status, f.new_status, f.changed_by, 'Reason: ' || f.reason, f.center_id::text
  from public.facility_status_audit f join public.evacuation_centers c on c.center_id = f.center_id
  where f.changed_at >= p_from and f.changed_at < p_to)
  union all
  (select f.changed_at, 'facility', 'Center capacity changed', c.center_name, null,
         f.old_capacity::text, f.new_capacity::text, f.changed_by, null, f.center_id::text
  from public.facility_capacity_audit f join public.evacuation_centers c on c.center_id = f.center_id
  where f.changed_at >= p_from and f.changed_at < p_to)
  union all
  -- 4. Disaster event declarations and resolutions.
  (select d.recorded_at, 'disaster_event',
         case d.action when 'declared' then 'Disaster event declared' else 'Disaster event resolved' end,
         e.name, e.barangay_id,
         case d.action when 'resolved' then 'active' end,
         case d.action when 'declared' then 'active' else 'resolved' end,
         d.actor_uid,
         concat_ws(' · ', 'Hazard: ' || e.hazard_type, 'Location: ' || e.location_description,
           case when d.action = 'resolved' then 'Reason: ' || coalesce(d.details->>'reason', e.resolution_reason) end),
         e.event_id::text
  from public.disaster_event_audit d join public.disaster_events e on e.event_id = d.event_id
  where d.recorded_at >= p_from and d.recorded_at < p_to
    and (actor_role = 'super_admin' or e.barangay_id = actor_barangay))
  union all
  -- 5. Missing-person manifest actions.
  (select a.recorded_at, 'missing_person',
         case a.action when 'reported' then 'Missing-person report filed' when 'found' then 'Missing person marked found'
           else 'Missing-person report withdrawn' end,
         m.full_name, m.barangay_id,
         case when a.action <> 'reported' then 'missing' end,
         case a.action when 'reported' then 'missing' else a.action end,
         a.actor_uid,
         case a.action
           when 'reported' then concat_ws(' · ', 'Reported by: ' || m.reporter_name,
             case when m.last_seen_location <> '' then 'Last seen: ' || m.last_seen_location end)
           when 'found' then concat_ws(' · ', coalesce(a.details->>'note', m.reconciliation_note),
             case when a.details->>'matched_resident_uid' is not null then 'Matched to rescued directory' end)
           else coalesce(a.details->>'reason', m.reconciliation_note) end,
         m.report_id::text
  from public.missing_person_report_audit a join public.missing_person_reports m on m.report_id = a.report_id
  where a.recorded_at >= p_from and a.recorded_at < p_to
    and (actor_role = 'super_admin' or m.barangay_id = actor_barangay))
  union all
  -- 6. Verification documents: uploads and reviews.
  (select v.uploaded_at, 'verification', 'Verification document uploaded',
         concat_ws(' ', u.f_name, u.l_name), r.barangay_id, null, 'pending', v.uid,
         'Document: ' || coalesce(t.type_name, 'unknown type'), v.doc_id::text
  from public.verification_documents v
  join public.users u on u.uid = v.uid
  left join public.residents r on r.uid = v.uid
  left join public.document_types t on t.type_id = v.type_id
  where v.uploaded_at >= p_from and v.uploaded_at < p_to
    and (actor_role = 'super_admin' or r.barangay_id = actor_barangay))
  union all
  (select v.reviewed_at, 'verification', 'Verification document reviewed',
         concat_ws(' ', u.f_name, u.l_name), r.barangay_id, 'pending', v.review_status::text, v.reviewed_by,
         concat_ws(' · ', 'Document: ' || coalesce(t.type_name, 'unknown type'),
           case when v.rejection_reason is not null then 'Reason: ' || v.rejection_reason end),
         v.doc_id::text
  from public.verification_documents v
  join public.users u on u.uid = v.uid
  left join public.residents r on r.uid = v.uid
  left join public.document_types t on t.type_id = v.type_id
  where v.reviewed_at is not null and v.reviewed_at >= p_from and v.reviewed_at < p_to
    and (actor_role = 'super_admin' or r.barangay_id = actor_barangay))
  union all
  -- 7. SOS alerts raised (only creation time is recorded).
  (select s.created_at, 'sos', 'SOS alert raised', concat_ws(' ', u.f_name, u.l_name), r.barangay_id,
         null, coalesce(s.status, 'active'), r.uid,
         concat_ws(' · ', 'Type: ' || s.alert_type, 'Level: ' || s.alert_level::text), s.alert_id::text
  from public.sos_alerts s
  join public.residents r on r.uid::text = s.resident_uid
  join public.users u on u.uid = r.uid
  where s.created_at >= p_from and s.created_at < p_to
    and (actor_role = 'super_admin' or r.barangay_id = actor_barangay))
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
        'occurred_at', e.occurred_at, 'category', e.category, 'action', e.action, 'subject', e.subject,
        'barangay_id', e.barangay_id, 'from_value', e.from_value, 'to_value', e.to_value,
        'actor_name', case when e.actor_uid is null then null
          else coalesce(nullif(concat_ws(' ', au.f_name, au.l_name), ''), e.actor_uid::text) end,
        'actor_role', au.role::text, 'details', nullif(e.details, ''), 'ref_id', e.ref_id
      ) order by e.occurred_at, e.category, e.ref_id), '[]'::jsonb)
    into total, events
  from ev e left join public.users au on au.uid = e.actor_uid;

  if total > 20000 then
    raise exception 'This range has % events (limit 20,000). Choose a shorter date range.', total;
  end if;

  select jsonb_build_object(
    'generated_at', clock_timestamp(),
    'from', p_from, 'to', p_to,
    'scope', case when actor_role = 'super_admin' then 'All barangays' else
      coalesce((select barangay_name from public.barangays where barangay_id = actor_barangay), 'Barangay ' || actor_barangay) end,
    'barangays', (select coalesce(jsonb_agg(jsonb_build_object('barangay_id', s.barangay_id, 'barangay_name', s.barangay_name) order by s.barangay_name), '[]'::jsonb)
      from public.barangays s where actor_role = 'super_admin' or s.barangay_id = actor_barangay),
    'events', events
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_operational_timeline(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_operational_timeline(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
