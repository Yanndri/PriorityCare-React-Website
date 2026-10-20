-- Step 10: deleting a resident from the web.
-- The old web delete removed only the public.users row, so it failed on any resident registered since
-- step 2: their household still pointed at them (households.head_uid). It also left the sign-in account
-- behind. This removes the household, its members and profile details, then the Auth account, which
-- cascades to users, residents, documents and disabilities.
-- A resident with operational history (SOS, dispatch, evacuation or missing-person records, hazard
-- reports) is refused: those records feed the reports, so archive the account instead of deleting it.
begin;

create or replace function public.delete_resident_account(p_uid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare hh uuid[]; blockers text[];
begin
  if not exists(select 1 from public.users where uid = p_uid and role::text = 'resident') then
    raise exception 'Resident not found.';
  end if;
  if not public.staff_can_access_resident(p_uid) then
    raise exception 'This resident is not in your authorized barangay.' using errcode = '42501';
  end if;
  select coalesce(array_agg(household_id), '{}') into hh from public.households where head_uid = p_uid;

  blockers := array_remove(array[
    case when exists(select 1 from public.sos_alerts where resident_uid = p_uid) then 'SOS alerts' end,
    case when exists(select 1 from public.dispatch_tickets where resident_uid = p_uid) then 'dispatch tickets' end,
    case when exists(select 1 from public.evacuation_records e where e.resident_uid = p_uid
      or e.member_id in (select member_id from public.household_members where household_id = any(hh))) then 'evacuation records' end,
    case when exists(select 1 from public.missing_person_reports m where p_uid in (m.resident_uid, m.matched_resident_uid, m.reported_by))
      then 'missing-person reports' end,
    case when exists(select 1 from public.hazard_reports where reported_by = p_uid) then 'hazard reports' end
  ], null);
  if cardinality(blockers) > 0 then
    raise exception 'Cannot delete: this resident has % on record. Those records are part of the disaster reports, so suspend or archive the account instead.',
      array_to_string(blockers, ', ');
  end if;

  delete from public.resident_profile_details where resident_uid = p_uid or household_id = any(hh);
  delete from public.households where household_id = any(hh); -- members cascade
  delete from auth.users where id = p_uid;                    -- cascades to users, residents, documents
  if not found then
    -- Profile without a sign-in account (old test data).
    delete from public.users where uid = p_uid;
  end if;
exception when foreign_key_violation then
  raise exception 'Cannot delete: other records still refer to this resident (%). Archive the account instead.', sqlerrm;
end;
$$;
revoke all on function public.delete_resident_account(uuid) from public, anon;
grant execute on function public.delete_resident_account(uuid) to authenticated;

commit;
