-- Module 2.2: map sitio catchments to designated primary (and alternate) evacuation shelters.
-- Requires 20261014_disaster_events.sql (assert_disaster_admin). One plan row per sitio; edits are
-- upserts and every change is kept in an audit table. Existing data is not modified.
begin;

create table if not exists public.sitio_shelter_plans (
  sitio_id integer primary key references public.sitios(sitio_id),
  primary_center_id integer references public.evacuation_centers(center_id),
  alternate_center_ids integer[] not null default '{}' check (cardinality(alternate_center_ids) <= 3),
  note text not null default '' check (length(note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (primary_center_id is not null or cardinality(alternate_center_ids) = 0),
  check (not (primary_center_id = any(alternate_center_ids)))
);

create table if not exists public.sitio_shelter_plan_audit (
  audit_id bigint generated always as identity primary key,
  sitio_id integer not null references public.sitios(sitio_id),
  previous jsonb,
  current jsonb not null,
  actor_uid uuid not null references auth.users(id),
  changed_at timestamptz not null default clock_timestamp()
);

alter table public.sitio_shelter_plans enable row level security;
alter table public.sitio_shelter_plan_audit enable row level security;
revoke all on public.sitio_shelter_plans, public.sitio_shelter_plan_audit from public, anon, authenticated;

-- Plans for the caller's scope (own sitio for admins, all for super admins), every shelter
-- (shelters are shared across sitios), and the population each plan sends to each shelter.
create or replace function public.get_shelter_assignments()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_role text; actor_sitio integer;
begin
  perform public.assert_disaster_admin();
  select role::text, assigned_sitio_id into actor_role, actor_sitio from public.users where uid = auth.uid();
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'can_edit_all', actor_role = 'super_admin',
    'sitios', (select coalesce(jsonb_agg(jsonb_build_object(
        'sitio_id', s.sitio_id, 'sitio_name', s.sitio_name,
        'editable', actor_role = 'super_admin' or s.sitio_id = actor_sitio,
        'residents', (select count(*) from public.residents r where r.sitio_id = s.sitio_id),
        'dependents', (select coalesce(sum(jsonb_array_length(h.household_members)), 0) from public.households h where h.sitio_id = s.sitio_id),
        'centroid_lat', (select avg(r.gps_lat) from public.residents r where r.sitio_id = s.sitio_id
            and r.gps_lat between -90 and 90 and r.gps_long between -180 and 180 and not (r.gps_lat = 0 and r.gps_long = 0)),
        'centroid_long', (select avg(r.gps_long) from public.residents r where r.sitio_id = s.sitio_id
            and r.gps_lat between -90 and 90 and r.gps_long between -180 and 180 and not (r.gps_lat = 0 and r.gps_long = 0)),
        'primary_center_id', p.primary_center_id,
        'alternate_center_ids', coalesce(to_jsonb(p.alternate_center_ids), '[]'::jsonb),
        'note', coalesce(p.note, ''),
        'updated_at', p.updated_at,
        'updated_by_name', (select concat_ws(' ', u.f_name, u.l_name) from public.users u where u.uid = p.updated_by)
      ) order by s.sitio_name), '[]'::jsonb)
      from public.sitios s left join public.sitio_shelter_plans p on p.sitio_id = s.sitio_id),
    -- All sitios' primary assignments are needed to show how full each shelter's plan is.
    'centers', (select coalesce(jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'status', c.status, 'capacity', c.capacity,
        'gps_lat', c.gps_lat, 'gps_long', c.gps_long,
        'primary_for', (select coalesce(jsonb_agg(p.sitio_id order by p.sitio_id), '[]'::jsonb)
          from public.sitio_shelter_plans p where p.primary_center_id = c.center_id),
        'planned_population', (select coalesce(sum(
            (select count(*) from public.residents r where r.sitio_id = p.sitio_id)
            + (select coalesce(sum(jsonb_array_length(h.household_members)), 0) from public.households h where h.sitio_id = p.sitio_id)), 0)
          from public.sitio_shelter_plans p where p.primary_center_id = c.center_id)
      ) order by c.center_name), '[]'::jsonb) from public.evacuation_centers c)
  );
end;
$$;
revoke all on function public.get_shelter_assignments() from public, anon;
grant execute on function public.get_shelter_assignments() to authenticated;

-- Set (or clear, with p_primary = null) the shelter plan for one sitio.
create or replace function public.set_sitio_shelters(p_sitio integer, p_primary integer, p_alternates integer[], p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_plan public.sitio_shelter_plans; new_plan public.sitio_shelter_plans;
  alts integer[] := coalesce(p_alternates, '{}');
begin
  perform public.assert_disaster_admin(p_sitio);
  if p_sitio is null or not exists (select 1 from public.sitios where sitio_id = p_sitio) then
    raise exception 'Select a valid sitio.';
  end if;
  if p_primary is null and cardinality(alts) > 0 then
    raise exception 'Choose a primary shelter before adding alternates.';
  end if;
  if cardinality(alts) > 3 then raise exception 'Choose at most 3 alternate shelters.'; end if;
  if (select count(distinct a) from unnest(alts) a) <> cardinality(alts) or p_primary = any(alts) then
    raise exception 'Each shelter can appear only once in a sitio plan.';
  end if;
  if exists (select 1 from unnest(array_append(alts, p_primary)) a
             where a is not null and not exists (select 1 from public.evacuation_centers c where c.center_id = a)) then
    raise exception 'One of the selected shelters does not exist.';
  end if;
  if p_primary is not null and exists (select 1 from public.evacuation_centers c where c.center_id = p_primary and c.status = 'closed') then
    raise exception 'A closed evacuation center cannot be a primary shelter. Reopen it or choose another.';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Keep the note under 500 characters.'; end if;

  select * into old_plan from public.sitio_shelter_plans where sitio_id = p_sitio for update;
  insert into public.sitio_shelter_plans as p (sitio_id, primary_center_id, alternate_center_ids, note, updated_at, updated_by)
    values (p_sitio, p_primary, alts, btrim(coalesce(p_note, '')), clock_timestamp(), auth.uid())
    on conflict (sitio_id) do update set primary_center_id = excluded.primary_center_id,
      alternate_center_ids = excluded.alternate_center_ids, note = excluded.note,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
    returning * into new_plan;
  insert into public.sitio_shelter_plan_audit(sitio_id, previous, current, actor_uid)
    values (p_sitio, case when old_plan.sitio_id is null then null else to_jsonb(old_plan) end, to_jsonb(new_plan), auth.uid());
end;
$$;
revoke all on function public.set_sitio_shelters(integer, integer, integer[], text) from public, anon;
grant execute on function public.set_sitio_shelters(integer, integer, integer[], text) to authenticated;

notify pgrst, 'reload schema';
commit;
