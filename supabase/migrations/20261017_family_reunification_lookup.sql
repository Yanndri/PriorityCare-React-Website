-- Cross-facility evacuee lookup for family reunification (Module 2.6).
-- Requires 20261014_disaster_events.sql (assert_disaster_admin) and
-- 20261014_missing_person_reconciliation.sql (missing_person_reports, latest_evacuation_status).
-- Read-only over existing data. Adds one private audit table recording every lookup.
begin;

create table if not exists public.reunification_lookup_audit (
  audit_id bigint generated always as identity primary key,
  actor_uid uuid not null references auth.users(id),
  lookup text not null check (lookup in ('search','household')),
  query text,
  center_id integer,
  resident_uid uuid,
  result_count integer not null,
  looked_up_at timestamptz not null default clock_timestamp()
);
alter table public.reunification_lookup_audit enable row level security;
revoke all on public.reunification_lookup_audit from public, anon, authenticated;

-- One row per registered resident with their latest evacuation record and household.
-- Internal helper; not callable from the browser.
create or replace function public.reunification_people()
returns table (
  uid uuid, full_name text, sex text, birthdate date, home_sitio_id integer, home_sitio text,
  latest_status text, latest_logged_at timestamptz, evacuated_at timestamptz,
  center_id integer, center_name text, center_status text,
  household_id uuid, household_name text, open_missing_report boolean
) language sql stable security definer set search_path = '' as $$
  select r.uid,
         concat_ws(' ', u.f_name, nullif(u.m_name, ''), u.l_name),
         r.sex::text, r.birthdate, r.sitio_id, s.sitio_name,
         le.evac_status, le.logged_at, le.evacuated_at,
         le.evac_center_id, c.center_name, c.status,
         h.household_id, h.household_name,
         exists (select 1 from public.missing_person_reports m where m.resident_uid = r.uid and m.status = 'missing')
  from public.residents r
  join public.users u on u.uid = r.uid
  left join public.sitios s on s.sitio_id = r.sitio_id
  left join lateral (
    select er.evac_status::text as evac_status, er.logged_at, er.evacuated_at, er.evac_center_id
    from public.evacuation_records er where er.resident_uid = r.uid
    order by er.logged_at desc nulls last, er.evacuated_at desc nulls last, er.record_id limit 1
  ) le on true
  left join public.evacuation_centers c on c.center_id = le.evac_center_id
  left join public.resident_profile_details d on d.resident_uid = r.uid
  left join public.households h on h.household_id = coalesce(d.household_id,
    (select hh.household_id from public.households hh where hh.head_uid = r.uid))
$$;
revoke all on function public.reunification_people() from public, anon, authenticated;

-- Search every evacuation center and the resident registry, across all sitios.
-- Reunification is cross-sitio by nature, so any active admin may search; results carry only
-- what is needed to reunite people (no contact numbers, addresses or medical details).
-- p_query: name words (each must match; case- and accent-insensitive, e.g. jose = José). p_center_id: limit to one center.
-- At least one of them is required. Returns at most 100 people.
create or replace function public.search_evacuees(p_query text, p_center_id integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q text := translate(lower(btrim(coalesce(p_query, ''))), 'áàâäéèêëíìîïóòôöúùûüñ', 'aaaaeeeeiiiioooouuuun'); words text[]; result jsonb; n integer;
begin
  perform public.assert_disaster_admin();
  if length(q) > 100 then raise exception 'Search text is too long.'; end if;
  words := array(select w from unnest(regexp_split_to_array(q, '\s+')) w where w <> '');
  if p_center_id is null and (cardinality(words) = 0 or length(replace(q, ' ', '')) < 2) then
    raise exception 'Type at least 2 letters of a name, or choose an evacuation center.';
  end if;

  with hits as (
    select p.* from public.reunification_people() p
    where (p_center_id is null or (p.center_id = p_center_id and p.latest_status = 'safely_evacuated'))
      and not exists (select 1 from unnest(words) w
        where position(w in translate(lower(p.full_name), 'áàâäéèêëíìîïóòôöúùûüñ', 'aaaaeeeeiiiioooouuuun')) = 0)
    order by coalesce(p.latest_status = 'safely_evacuated', false) desc, p.full_name, p.uid
    limit 101
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
      'uid', h.uid, 'full_name', h.full_name, 'sex', h.sex,
      'age', case when h.birthdate is not null then extract(year from age((now() at time zone 'Asia/Manila')::date, h.birthdate))::int end,
      'home_sitio', h.home_sitio, 'latest_status', h.latest_status, 'latest_logged_at', h.latest_logged_at,
      'evacuated_at', h.evacuated_at, 'center_id', h.center_id, 'center_name', h.center_name,
      'center_status', h.center_status, 'household_id', h.household_id, 'household_name', h.household_name,
      'open_missing_report', h.open_missing_report)), '[]'::jsonb)
    into n, result from hits h;

  insert into public.reunification_lookup_audit(actor_uid, lookup, query, center_id, result_count)
    values (auth.uid(), 'search', nullif(q, ''), p_center_id, least(n, 100));

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'has_more', n > 100,
    'people', case when n > 100 then (select jsonb_agg(e) from (select e from jsonb_array_elements(result) with ordinality t(e, i) where i <= 100) x) else result end,
    'centers', (select coalesce(jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'status', c.status,
        'sheltered', (select count(*) from public.reunification_people() p
          where p.center_id = c.center_id and p.latest_status = 'safely_evacuated')
      ) order by c.center_name), '[]'::jsonb) from public.evacuation_centers c)
  );
end;
$$;
revoke all on function public.search_evacuees(text, integer) from public, anon;
grant execute on function public.search_evacuees(text, integer) to authenticated;

-- Everyone in the same household as p_resident_uid, with where each person currently is,
-- plus the household's listed dependents who have no account (their location is unknown).
create or replace function public.get_evacuee_household(p_resident_uid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare person record; result jsonb; members jsonb; dependents jsonb;
begin
  perform public.assert_disaster_admin();
  select * into person from public.reunification_people() p where p.uid = p_resident_uid;
  if not found then raise exception 'Resident was not found.'; end if;

  if person.household_id is null then
    members := '[]'::jsonb; dependents := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'uid', p.uid, 'full_name', p.full_name, 'sex', p.sex,
        'age', case when p.birthdate is not null then extract(year from age((now() at time zone 'Asia/Manila')::date, p.birthdate))::int end,
        'is_head', h.head_uid = p.uid, 'home_sitio', p.home_sitio,
        'latest_status', p.latest_status, 'latest_logged_at', p.latest_logged_at,
        'center_id', p.center_id, 'center_name', p.center_name, 'open_missing_report', p.open_missing_report
      ) order by (h.head_uid = p.uid) desc, p.full_name), '[]'::jsonb)
      into members
    from public.reunification_people() p
    join public.households h on h.household_id = p.household_id
    where p.household_id = person.household_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'name', m->>'name', 'relationship', m->>'relationship', 'sex', m->>'sex', 'birthdate', m->>'birthdate')), '[]'::jsonb)
      into dependents
    from public.households h, jsonb_array_elements(h.household_members) m
    where h.household_id = person.household_id;
  end if;

  insert into public.reunification_lookup_audit(actor_uid, lookup, resident_uid, result_count)
    values (auth.uid(), 'household', p_resident_uid, jsonb_array_length(members));

  return jsonb_build_object(
    'household_id', person.household_id, 'household_name', person.household_name,
    'members', members, 'dependents', dependents);
end;
$$;
revoke all on function public.get_evacuee_household(uuid) from public, anon;
grant execute on function public.get_evacuee_household(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
