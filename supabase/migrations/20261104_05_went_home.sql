-- STEP 17 (2026-11-04): "Went home". Lets people leave an evacuation center so its count
-- goes back down and the center can be closed after a disaster.
-- * New evacuation status 'returned_home'. Records are never deleted (audit trail): each person
--   gets a new "went home" record, so their latest record no longer says they are at the center.
--   Walk-in groups have no account, so their single record is marked went home instead
--   (the change is still logged in evacuation_record_audit).
-- * Web: "Everyone went home" on a center card, and "Went home" for one person
--   (send_center_home). Only staff who can edit that center.
-- * App: when a household reports "We're back home", everyone in it who is still at a center
--   is marked went home.

alter type public.evac_status_type add value if not exists 'returned_home';

-- Marks people as went home. Pick them by center, by household, or one person by the record
-- shown on the web. Returns how many people were marked. Used only by the functions below.
create or replace function public.mark_went_home(p_center_id integer, p_household_id uuid, p_record_id uuid)
returns integer language plpgsql security definer set search_path to '' as $function$
declare rec record; n integer := 0;
begin
  for rec in
    select * from (
      select distinct on (coalesce(e.resident_uid, e.member_id, e.record_id)) e.*
      from public.evacuation_records e
      order by coalesce(e.resident_uid, e.member_id, e.record_id), e.logged_at desc nulls last, e.record_id desc
    ) latest
    where latest.evac_center_id is not null
      and latest.evac_status::text in ('in_transit', 'safely_evacuated')
      and (p_center_id is null or latest.evac_center_id = p_center_id)
      and (p_record_id is null or latest.record_id = p_record_id)
      and (p_household_id is null
           or public.resident_household_id(latest.resident_uid) = p_household_id
           or latest.member_id in (select m.member_id from public.household_members m where m.household_id = p_household_id))
  loop
    if rec.resident_uid is null and rec.member_id is null then
      update public.evacuation_records set evac_status = 'returned_home', logged_at = clock_timestamp()
      where record_id = rec.record_id;
    else
      insert into public.evacuation_records (resident_uid, member_id, barangay_id, rescuer_uid, evac_center_id, evac_status, logged_at)
      values (rec.resident_uid, rec.member_id, rec.barangay_id, null, rec.evac_center_id, 'returned_home', clock_timestamp());
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$function$;
revoke all on function public.mark_went_home(integer, uuid, uuid) from public, anon, authenticated;

-- Web button. p_record_id null = everyone at the center; otherwise only that person.
create or replace function public.send_center_home(p_center_id integer, p_record_id uuid default null)
returns integer language plpgsql security definer set search_path to '' as $function$
begin
  perform public.assert_facility_admin();
  perform public.assert_facility_editable(p_center_id);
  return public.mark_went_home(p_center_id, null, p_record_id);
end;
$function$;
revoke all on function public.send_center_home(integer, uuid) from public, anon;
grant execute on function public.send_center_home(integer, uuid) to authenticated;

-- Same as the live function, plus: "We're back home" marks the household as went home.
create or replace function public.insert_preemptive_evacuation_log(p_resident_uid uuid, p_event_id uuid, p_status text,
  p_destination_type text, p_center_id integer, p_destination_address text, p_headcount integer, p_note text, p_source text)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  r public.residents;
  v_household uuid;
  v_event uuid := p_event_id;
  v_type text := nullif(btrim(coalesce(p_destination_type, '')), '');
  v_address text := btrim(coalesce(p_destination_address, ''));
  v_center integer := p_center_id;
  v_headcount integer;
  v_id uuid;
begin
  select * into r from public.residents where uid = p_resident_uid;
  if not found then raise exception 'Resident not found.'; end if;

  if p_status is null or p_status not in ('staying_home', 'preparing', 'evacuating', 'arrived', 'returned_home') then
    raise exception 'Choose the evacuation status.';
  end if;

  if p_status in ('staying_home', 'returned_home') then
    v_type := null; v_center := null; v_address := '';
  else
    if v_type is null or v_type not in ('evacuation_center', 'relative_friend', 'other') then
      raise exception 'Choose where the household is going.';
    end if;
    if v_type = 'evacuation_center' then
      v_address := '';
      if v_center is null then raise exception 'Choose the evacuation center.'; end if;
      if not exists (select 1 from public.evacuation_centers c
                     where c.center_id = v_center and coalesce(c.status, 'open') <> 'closed') then
        raise exception 'That evacuation center is closed or does not exist. Choose another one.';
      end if;
    else
      v_center := null;
      if v_address = '' then raise exception 'Enter the address or place the household is going to.'; end if;
      if char_length(v_address) > 300 then raise exception 'Keep the destination under 300 characters.'; end if;
    end if;
  end if;

  if char_length(btrim(coalesce(p_note, ''))) > 500 then raise exception 'Keep the note under 500 characters.'; end if;

  v_household := public.resident_household_id(p_resident_uid);
  v_headcount := coalesce(p_headcount,
    1 + (select count(*) from public.household_members m where m.household_id = v_household)::integer);
  if v_headcount < 1 or v_headcount > 50 then raise exception 'Headcount must be between 1 and 50.'; end if;

  if v_event is not null then
    if not exists (select 1 from public.disaster_events e
                   where e.event_id = v_event and e.barangay_id = r.barangay_id and e.status = 'active') then
      raise exception 'The disaster event must be active and in the resident''s barangay.';
    end if;
  else
    select e.event_id into v_event from public.disaster_events e
    where e.barangay_id = r.barangay_id and e.status = 'active'
    order by e.started_at desc limit 1;
  end if;

  insert into public.preemptive_evacuation_logs (resident_uid, household_id, barangay_id, event_id, status,
      destination_type, destination_center_id, destination_address, headcount, note, source, reported_by, logged_at)
    values (p_resident_uid, v_household, r.barangay_id, v_event, p_status, v_type, v_center, v_address,
      v_headcount, btrim(coalesce(p_note, '')), p_source, auth.uid(), clock_timestamp())
    returning log_id into v_id;

  if v_type = 'evacuation_center' and p_status in ('evacuating', 'arrived') then
    insert into public.evacuation_records (resident_uid, barangay_id, rescuer_uid, evac_center_id, evac_status,
                                           evacuated_at, logged_at)
    values (p_resident_uid, r.barangay_id, case when p_source = 'rescuer' then auth.uid() end, v_center,
            case when p_status = 'arrived' then 'safely_evacuated' else 'in_transit' end::public.evac_status_type,
            case when p_status = 'arrived' then clock_timestamp() end, clock_timestamp());
  end if;

  -- New: back home = nobody in this household is at a center any more.
  if p_status = 'returned_home' then
    if v_household is not null then
      perform public.mark_went_home(null, v_household, null);
    else
      perform public.mark_went_home(null, null, (select e.record_id from public.evacuation_records e
        where e.resident_uid = p_resident_uid order by e.logged_at desc nulls last, e.record_id desc limit 1));
    end if;
  end if;

  return v_id;
end;
$function$;
