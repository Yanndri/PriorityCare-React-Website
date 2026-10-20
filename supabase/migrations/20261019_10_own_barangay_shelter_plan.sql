-- Step 7: a barangay admin plans only their own barangay.
-- They see only their barangay's plan row, and can pick their barangay's centres or municipal-wide ones
-- (no barangay). Sending people to another barangay's centre is a municipal decision: only a super admin
-- can set it, and the barangay admin keeps it when they edit their plan.
begin;

create or replace function public.get_shelter_assignments()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_role text; actor_barangay integer; is_super boolean;
begin
  perform public.assert_disaster_admin();
  select role::text, assigned_barangay_id into actor_role, actor_barangay from public.users where uid = auth.uid();
  is_super := actor_role = 'super_admin';
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'can_edit_all', is_super,
    'barangays', (select coalesce(jsonb_agg(jsonb_build_object(
        'barangay_id', s.barangay_id, 'barangay_name', s.barangay_name,
        'editable', is_super or s.barangay_id = actor_barangay,
        'residents', (select count(*) from public.residents r where r.barangay_id = s.barangay_id),
        'dependents', (select count(*) from public.household_members hm join public.households h on h.household_id = hm.household_id where h.barangay_id = s.barangay_id),
        'centroid_lat', (select avg(r.gps_lat) from public.residents r where r.barangay_id = s.barangay_id
            and r.gps_lat between -90 and 90 and r.gps_long between -180 and 180 and not (r.gps_lat = 0 and r.gps_long = 0)),
        'centroid_long', (select avg(r.gps_long) from public.residents r where r.barangay_id = s.barangay_id
            and r.gps_lat between -90 and 90 and r.gps_long between -180 and 180 and not (r.gps_lat = 0 and r.gps_long = 0)),
        'primary_center_id', p.primary_center_id,
        'alternate_center_ids', coalesce(to_jsonb(p.alternate_center_ids), '[]'::jsonb),
        'note', coalesce(p.note, ''),
        'updated_at', p.updated_at,
        'updated_by_name', (select concat_ws(' ', u.f_name, u.l_name) from public.users u where u.uid = p.updated_by)
      ) order by s.barangay_name), '[]'::jsonb)
      from public.barangays s left join public.barangay_shelter_plans p on p.barangay_id = s.barangay_id
      where is_super or s.barangay_id = actor_barangay),
    -- Planned population still counts every barangay's primary assignment, so a shared shelter's load is right.
    'centers', (select coalesce(jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'status', c.status, 'capacity', c.capacity,
        'gps_lat', c.gps_lat, 'gps_long', c.gps_long, 'barangay_id', c.barangay_id,
        'primary_for', (select coalesce(jsonb_agg(p.barangay_id order by p.barangay_id), '[]'::jsonb)
          from public.barangay_shelter_plans p where p.primary_center_id = c.center_id
            and (is_super or p.barangay_id = actor_barangay)),
        'other_barangays_planned', (select count(*) from public.barangay_shelter_plans p
          where p.primary_center_id = c.center_id and not is_super and p.barangay_id is distinct from actor_barangay),
        'planned_population', (select coalesce(sum(
            (select count(*) from public.residents r where r.barangay_id = p.barangay_id)
            + (select count(*) from public.household_members hm join public.households h on h.household_id = hm.household_id where h.barangay_id = p.barangay_id)), 0)
          from public.barangay_shelter_plans p where p.primary_center_id = c.center_id)
      ) order by c.center_name), '[]'::jsonb) from public.evacuation_centers c
      where is_super or c.barangay_id = actor_barangay or c.barangay_id is null or public.facility_visible(c.center_id))
  );
end;
$$;

create or replace function public.set_barangay_shelters(p_barangay integer, p_primary integer, p_alternates integer[], p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_plan public.barangay_shelter_plans; new_plan public.barangay_shelter_plans;
  alts integer[] := coalesce(p_alternates, '{}');
begin
  perform public.assert_disaster_admin(p_barangay);
  if p_barangay is null or not exists (select 1 from public.barangays where barangay_id = p_barangay) then
    raise exception 'Select a valid barangay.';
  end if;
  if p_primary is null and cardinality(alts) > 0 then
    raise exception 'Choose a primary shelter before adding alternates.';
  end if;
  if cardinality(alts) > 3 then raise exception 'Choose at most 3 alternate shelters.'; end if;
  if (select count(distinct a) from unnest(alts) a) <> cardinality(alts) or p_primary = any(alts) then
    raise exception 'Each shelter can appear only once in a barangay plan.';
  end if;
  if exists (select 1 from unnest(array_append(alts, p_primary)) a
             where a is not null and not exists (select 1 from public.evacuation_centers c where c.center_id = a)) then
    raise exception 'One of the selected shelters does not exist.';
  end if;
  if p_primary is not null and exists (select 1 from public.evacuation_centers c where c.center_id = p_primary and c.status = 'closed') then
    raise exception 'A closed evacuation center cannot be a primary shelter. Reopen it or choose another.';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Keep the note under 500 characters.'; end if;

  select * into old_plan from public.barangay_shelter_plans where barangay_id = p_barangay for update;
  -- Barangay admins: own-barangay or municipal-wide centres, plus any the municipal admin already put in this plan.
  if not coalesce((select is_super from public.facility_actor()), false) and exists (
      select 1 from unnest(array_append(alts, p_primary)) a
      join public.evacuation_centers c on c.center_id = a
      where c.barangay_id is not null and c.barangay_id <> p_barangay
        and not (a = old_plan.primary_center_id or a = any(coalesce(old_plan.alternate_center_ids, '{}'))))
  then
    raise exception 'Choose a shelter in your barangay. Only the municipal admin can assign another barangay''s shelter.' using errcode = '42501';
  end if;
  insert into public.barangay_shelter_plans as p (barangay_id, primary_center_id, alternate_center_ids, note, updated_at, updated_by)
    values (p_barangay, p_primary, alts, btrim(coalesce(p_note, '')), clock_timestamp(), auth.uid())
    on conflict (barangay_id) do update set primary_center_id = excluded.primary_center_id,
      alternate_center_ids = excluded.alternate_center_ids, note = excluded.note,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
    returning * into new_plan;
  insert into public.barangay_shelter_plan_audit(barangay_id, previous, current, actor_uid)
    values (p_barangay, case when old_plan.barangay_id is null then null else to_jsonb(old_plan) end, to_jsonb(new_plan), auth.uid());
end;
$$;

commit;
