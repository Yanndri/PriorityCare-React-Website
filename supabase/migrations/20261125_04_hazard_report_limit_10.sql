-- Residents can send up to 10 hazard reports in 10 minutes (was 3). Everything else unchanged.

create or replace function public.report_hazard(p_type text, p_description text, p_lat numeric, p_lng numeric, p_barangay_id integer, p_photo_path text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_role text; v_barangay integer; v_id uuid; v_status text := 'unverified';
begin
  select role::text into v_role from public.users where uid = auth.uid() and account_status = 'active';
  if v_role is null then raise exception 'Sign in to report a hazard.'; end if;
  if upper(coalesce(p_type, '')) not in ('FIRE', 'FLOOD', 'BLOCK', 'WIRE', 'LANDSLIDE', 'OTHER') then
    raise exception 'Choose the type of hazard.';
  end if;
  if p_lat is null or p_lng is null then raise exception 'Pin the hazard on the map.'; end if;
  -- New (STEP 20): the pin must be inside a Cordova barangay.
  if public.barangay_at(p_lat, p_lng) is null then
    raise exception 'That spot is outside Cordova. Hazards can only be reported inside the municipality.';
  end if;
  if p_photo_path is not null and p_photo_path not like auth.uid()::text || '/%' then
    raise exception 'Upload the photo into your own folder first.';
  end if;
  v_barangay := coalesce(p_barangay_id, public.barangay_at(p_lat, p_lng));
  if not exists (select 1 from public.barangays where barangay_id = v_barangay) then
    raise exception 'Unknown barangay.';
  end if;
  if v_role = 'resident' and (select count(*) from public.hazard_reports
      where reported_by = auth.uid() and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'You have sent several reports just now. Please wait a few minutes.';
  end if;
  -- Field teams and barangay staff are trusted reporters.
  if v_role = 'rescuer' or public.staff_can_access_barangay(v_barangay) then v_status := 'confirmed'; end if;
  insert into public.hazard_reports (barangay_id, event_id, hazard_type, description, latitude, longitude, photo_path,
                                     status, reported_by, reporter_role, reviewed_by, reviewed_at)
  values (v_barangay,
          (select e.event_id from public.disaster_events e where e.barangay_id = v_barangay and e.status = 'active'
           order by e.declared_at desc limit 1),
          upper(p_type), btrim(coalesce(p_description, '')), p_lat, p_lng, p_photo_path, v_status, auth.uid(), v_role,
          case when v_status = 'confirmed' then auth.uid() end,
          case when v_status = 'confirmed' then clock_timestamp() end)
  returning hazard_id into v_id;
  return v_id;
end;
$function$;
