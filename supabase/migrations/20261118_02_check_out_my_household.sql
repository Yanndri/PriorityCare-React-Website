-- STEP 28: residents check themselves and their household members out of an evacuation centre
-- (2026-11-18), so the barangay staff don't have to do every check-out.
-- check_out_my_household(p_people): p_people = the uids / member_ids leaving, or null for everyone.
-- Only people in the caller's own household, and only those currently at a centre.
-- When nobody is left at a centre, the household's report also becomes "Back home".
-- Records are never deleted (a "went home" record is added). Run in the Supabase SQL Editor. Safe to run twice.

begin;

create or replace function public.check_out_my_household(p_people uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_household uuid; v_n integer := 0; rec record;
begin
  if not exists (select 1 from public.residents r join public.users u on u.uid = r.uid
                 where r.uid = auth.uid() and u.account_status = 'active') then
    raise exception 'Only active resident accounts can check out.' using errcode = '42501';
  end if;
  v_household := public.resident_household_id(auth.uid());

  -- Latest record of each person in this household that is still at a centre.
  for rec in
    select latest.record_id from (
      select distinct on (coalesce(e.resident_uid, e.member_id)) e.*
        from public.evacuation_records e
       where e.resident_uid = auth.uid()
          or (v_household is not null and e.resident_uid in
                (select d.resident_uid from public.resident_profile_details d where d.household_id = v_household))
          or (v_household is not null and e.member_id in
                (select m.member_id from public.household_members m where m.household_id = v_household))
       order by coalesce(e.resident_uid, e.member_id), e.logged_at desc nulls last, e.record_id desc
    ) latest
    where latest.evac_center_id is not null
      and latest.evac_status::text in ('in_transit', 'safely_evacuated')
      and (p_people is null or coalesce(latest.resident_uid, latest.member_id) = any(p_people))
  loop
    v_n := v_n + public.mark_went_home(null, null, rec.record_id);
  end loop;

  if v_n = 0 then
    raise exception 'Nobody you chose is checked in at an evacuation centre.';
  end if;

  -- Everyone out: the household's report becomes "Back home" (staff see it on the web).
  if not exists (
    select 1 from (
      select distinct on (coalesce(e.resident_uid, e.member_id)) e.evac_status, e.evac_center_id
        from public.evacuation_records e
       where e.resident_uid = auth.uid()
          or (v_household is not null and e.member_id in
                (select m.member_id from public.household_members m where m.household_id = v_household))
       order by coalesce(e.resident_uid, e.member_id), e.logged_at desc nulls last, e.record_id desc
    ) x where x.evac_center_id is not null and x.evac_status::text in ('in_transit', 'safely_evacuated')
  ) then
    perform public.insert_preemptive_evacuation_log(auth.uid(), null, 'returned_home', null, null, '', null,
      'Checked out in the app', 'resident');
  end if;

  return v_n;
end;
$$;

revoke all on function public.check_out_my_household(uuid[]) from public, anon;
grant execute on function public.check_out_my_household(uuid[]) to authenticated;

commit;
