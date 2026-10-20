-- Missing Persons Manifest + reconciliation against the Master Rescued Directory.
-- Requires 20261014_disaster_events.sql (reuses public.assert_disaster_admin and public.disaster_events).
-- Adds new tables and guarded RPCs only; it never modifies resident, evacuation, SOS or account records.
begin;

create table if not exists public.missing_person_reports (
  report_id uuid primary key default gen_random_uuid(),
  barangay_id integer not null references public.barangays(barangay_id),
  event_id uuid references public.disaster_events(event_id),
  resident_uid uuid references public.residents(uid),
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  sex text check (sex in ('male','female')),
  approx_age integer check (approx_age between 0 and 130),
  last_seen_location text not null default '' check (length(last_seen_location) <= 500),
  last_seen_at timestamptz check (last_seen_at is null or isfinite(last_seen_at)),
  reporter_name text not null check (length(btrim(reporter_name)) between 1 and 200),
  reporter_contact text not null default '' check (length(reporter_contact) <= 50),
  notes text not null default '' check (length(notes) <= 2000),
  status text not null default 'missing' check (status in ('missing','found','withdrawn')),
  matched_resident_uid uuid references public.residents(uid),
  reconciled_at timestamptz,
  reconciled_by uuid references auth.users(id),
  reconciliation_note text check (reconciliation_note is null or length(reconciliation_note) <= 1000),
  reported_at timestamptz not null default now(),
  reported_by uuid not null references auth.users(id),
  check ((status = 'missing' and matched_resident_uid is null and reconciled_at is null
            and reconciled_by is null and reconciliation_note is null)
      or (status in ('found','withdrawn') and reconciled_at is not null
            and reconciled_by is not null and reconciliation_note is not null)),
  check (status <> 'withdrawn' or matched_resident_uid is null)
);
-- One open report per registered resident.
create unique index if not exists missing_person_reports_open_resident
  on public.missing_person_reports(resident_uid) where status = 'missing' and resident_uid is not null;
create index if not exists missing_person_reports_barangay_status
  on public.missing_person_reports(barangay_id, status);

create table if not exists public.missing_person_report_audit (
  audit_id bigint generated always as identity primary key,
  report_id uuid not null references public.missing_person_reports(report_id),
  action text not null check (action in ('reported','found','withdrawn')),
  actor_uid uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  details jsonb not null
);

alter table public.missing_person_reports enable row level security;
alter table public.missing_person_report_audit enable row level security;
revoke all on public.missing_person_reports, public.missing_person_report_audit from public, anon, authenticated;

-- Latest evacuation record per resident (by logged_at, then evacuated_at).
create or replace function public.latest_evacuation_status(p_resident uuid)
returns text language sql stable security definer set search_path = '' as $$
  select er.evac_status::text from public.evacuation_records er
  where er.resident_uid = p_resident
  order by er.logged_at desc nulls last, er.evacuated_at desc nulls last, er.record_id
  limit 1
$$;
revoke all on function public.latest_evacuation_status(uuid) from public, anon, authenticated;

create or replace function public.get_rescue_reconciliation()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; actor_role text; actor_barangay integer;
begin
  perform public.assert_disaster_admin();
  select role::text, assigned_barangay_id into actor_role, actor_barangay from public.users where uid = auth.uid();
  if (select count(*) from public.missing_person_reports where actor_role = 'super_admin' or barangay_id = actor_barangay) > 5000 then
    raise exception 'Missing-person manifest exceeds 5,000 reports. Add server pagination before loading it.';
  end if;
  if (select count(*) from public.residents where actor_role = 'super_admin' or barangay_id = actor_barangay) > 20000 then
    raise exception 'Resident registry exceeds 20,000 records. Add server pagination before reconciling.';
  end if;
  select jsonb_build_object(
    'generated_at', clock_timestamp(),
    'barangays', (select coalesce(jsonb_agg(jsonb_build_object('barangay_id', s.barangay_id, 'barangay_name', s.barangay_name) order by s.barangay_name), '[]'::jsonb)
      from public.barangays s where actor_role = 'super_admin' or s.barangay_id = actor_barangay),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event_id', e.event_id, 'barangay_id', e.barangay_id, 'name', e.name,
        'hazard_type', e.hazard_type, 'status', e.status, 'started_at', e.started_at) order by e.declared_at desc), '[]'::jsonb)
      from public.disaster_events e where actor_role = 'super_admin' or e.barangay_id = actor_barangay),
    'reports', (select coalesce(jsonb_agg(to_jsonb(m) order by m.reported_at desc, m.report_id), '[]'::jsonb)
      from public.missing_person_reports m where actor_role = 'super_admin' or m.barangay_id = actor_barangay),
    'residents', (select coalesce(jsonb_agg(jsonb_build_object(
        'uid', r.uid, 'barangay_id', r.barangay_id,
        'f_name', u.f_name, 'm_name', u.m_name, 'l_name', u.l_name,
        'sex', r.sex::text, 'birthdate', r.birthdate,
        'latest_status', le.evac_status, 'latest_logged_at', le.logged_at, 'evacuated_at', le.evacuated_at,
        'center_id', le.evac_center_id, 'center_name', c.center_name
      ) order by u.l_name, u.f_name, r.uid), '[]'::jsonb)
      from public.residents r
      join public.users u on u.uid = r.uid
      left join lateral (
        select er.evac_status::text as evac_status, er.logged_at, er.evacuated_at, er.evac_center_id
        from public.evacuation_records er where er.resident_uid = r.uid
        order by er.logged_at desc nulls last, er.evacuated_at desc nulls last, er.record_id limit 1
      ) le on true
      left join public.evacuation_centers c on c.center_id = le.evac_center_id
      where actor_role = 'super_admin' or r.barangay_id = actor_barangay)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_rescue_reconciliation() from public, anon;
grant execute on function public.get_rescue_reconciliation() to authenticated;

create or replace function public.file_missing_person_report(
  p_barangay integer, p_event_id uuid, p_resident_uid uuid, p_full_name text,
  p_sex text, p_age integer, p_last_seen_location text, p_last_seen_at timestamptz,
  p_reporter_name text, p_reporter_contact text, p_notes text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_report public.missing_person_reports;
begin
  perform public.assert_disaster_admin(p_barangay);
  if p_barangay is null then raise exception 'Select a barangay.'; end if;
  if p_event_id is not null and not exists (select 1 from public.disaster_events e
      where e.event_id = p_event_id and e.barangay_id = p_barangay and e.status = 'active') then
    raise exception 'The linked disaster event must be an active event in the same barangay.';
  end if;
  if p_resident_uid is not null and not exists (select 1 from public.residents r
      where r.uid = p_resident_uid and r.barangay_id = p_barangay) then
    raise exception 'The linked resident is not registered in this barangay.';
  end if;
  if p_last_seen_at is not null and (not isfinite(p_last_seen_at) or p_last_seen_at > clock_timestamp()) then
    raise exception 'Last-seen time must be valid and cannot be in the future.';
  end if;
  insert into public.missing_person_reports(barangay_id, event_id, resident_uid, full_name, sex, approx_age,
      last_seen_location, last_seen_at, reporter_name, reporter_contact, notes, reported_by)
    values (p_barangay, p_event_id, p_resident_uid, btrim(p_full_name), nullif(btrim(coalesce(p_sex, '')), ''), p_age,
      btrim(coalesce(p_last_seen_location, '')), p_last_seen_at, btrim(p_reporter_name),
      btrim(coalesce(p_reporter_contact, '')), btrim(coalesce(p_notes, '')), auth.uid())
    returning * into new_report;
  insert into public.missing_person_report_audit(report_id, action, actor_uid, details)
    values (new_report.report_id, 'reported', auth.uid(), to_jsonb(new_report));
  return new_report.report_id;
exception when unique_violation then
  raise exception 'This resident already has an open missing-person report.';
end;
$$;
revoke all on function public.file_missing_person_report(integer,uuid,uuid,text,text,integer,text,timestamptz,text,text,text) from public, anon;
grant execute on function public.file_missing_person_report(integer,uuid,uuid,text,text,integer,text,timestamptz,text,text,text) to authenticated;

-- Close a report as found. With p_resident_uid: confirms a match against the Master Rescued
-- Directory (latest evacuation record must be safely_evacuated). Without: found outside the
-- registry, and a note is required.
create or replace function public.mark_missing_person_found(p_report_id uuid, p_resident_uid uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_report public.missing_person_reports; note text := btrim(coalesce(p_note, ''));
begin
  perform public.assert_disaster_admin();
  select * into old_report from public.missing_person_reports where report_id = p_report_id for update;
  if not found then raise exception 'Report was not found.'; end if;
  perform public.assert_disaster_admin(old_report.barangay_id);
  if old_report.status <> 'missing' then raise exception 'Report is already closed. Refresh the manifest.'; end if;
  if length(note) > 1000 then raise exception 'Keep the note under 1,000 characters.'; end if;
  if p_resident_uid is null then
    if note = '' then raise exception 'Describe where or how the person was found.'; end if;
  else
    if old_report.resident_uid is not null and old_report.resident_uid <> p_resident_uid then
      raise exception 'This report is linked to a different registered resident.';
    end if;
    if not exists (select 1 from public.residents r where r.uid = p_resident_uid and r.barangay_id = old_report.barangay_id) then
      raise exception 'The matched resident is not registered in this barangay.';
    end if;
    if coalesce(public.latest_evacuation_status(p_resident_uid), '') <> 'safely_evacuated' then
      raise exception 'The matched resident is not in the Master Rescued Directory (latest record is not safely evacuated).';
    end if;
    if note = '' then note := 'Matched to Master Rescued Directory.'; end if;
  end if;
  update public.missing_person_reports set status = 'found', matched_resident_uid = p_resident_uid,
    reconciled_at = clock_timestamp(), reconciled_by = auth.uid(), reconciliation_note = note
    where report_id = p_report_id;
  insert into public.missing_person_report_audit(report_id, action, actor_uid, details)
    values (p_report_id, 'found', auth.uid(), jsonb_build_object('previous', to_jsonb(old_report),
      'matched_resident_uid', p_resident_uid, 'note', note));
end;
$$;
revoke all on function public.mark_missing_person_found(uuid,uuid,text) from public, anon;
grant execute on function public.mark_missing_person_found(uuid,uuid,text) to authenticated;

create or replace function public.withdraw_missing_person_report(p_report_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_report public.missing_person_reports;
begin
  perform public.assert_disaster_admin();
  select * into old_report from public.missing_person_reports where report_id = p_report_id for update;
  if not found then raise exception 'Report was not found.'; end if;
  perform public.assert_disaster_admin(old_report.barangay_id);
  if old_report.status <> 'missing' then raise exception 'Report is already closed. Refresh the manifest.'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'Enter a withdrawal reason of 1–1,000 characters.';
  end if;
  update public.missing_person_reports set status = 'withdrawn', reconciled_at = clock_timestamp(),
    reconciled_by = auth.uid(), reconciliation_note = btrim(p_reason) where report_id = p_report_id;
  insert into public.missing_person_report_audit(report_id, action, actor_uid, details)
    values (p_report_id, 'withdrawn', auth.uid(), jsonb_build_object('previous', to_jsonb(old_report), 'reason', btrim(p_reason)));
end;
$$;
revoke all on function public.withdraw_missing_person_report(uuid,text) from public, anon;
grant execute on function public.withdraw_missing_person_report(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
