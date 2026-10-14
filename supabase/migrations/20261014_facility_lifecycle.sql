-- Requires 20261014_facility_registration.sql. Keeps facilities and their history.
begin;
do $$ begin
  if to_regprocedure('public.assert_facility_admin()') is null then
    raise exception 'Apply 20261014_facility_registration.sql first.';
  end if;
end $$;
alter table public.evacuation_centers
  add column if not exists status text not null default 'active' check (status in ('active','closed')),
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id),
  add column if not exists closure_reason text;

create table if not exists public.facility_status_audit (
  audit_id bigint generated always as identity primary key,
  center_id integer not null references public.evacuation_centers(center_id),
  old_status text not null,
  new_status text not null,
  reason text not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);
alter table public.facility_status_audit enable row level security;
revoke all on public.facility_status_audit from anon, authenticated;

create or replace function public.change_evacuation_facility_status(
  p_center_id integer, p_status text, p_reason text, p_expected_status text
)
returns void language plpgsql security definer set search_path = '' as $$
declare old_status text; current_capacity integer; blocked integer;
begin
  perform public.assert_facility_admin();
  if p_status is null or p_status not in ('active','closed') then raise exception 'Invalid facility status.'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'A reason of 1–1,000 characters is required.'; end if;
  -- Wait for current admissions, and block new ones until the transition commits.
  lock table public.evacuation_records in share mode;
  select status,capacity into old_status,current_capacity from public.evacuation_centers where center_id=p_center_id for update;
  if not found then raise exception 'Facility not found.'; end if;
  if old_status is distinct from p_expected_status then raise exception 'Facility status changed. Refresh before trying again.'; end if;
  if old_status = p_status then raise exception 'Facility already has this status.'; end if;
  if p_status = 'closed' then
    select count(*)::integer into blocked from (
      select distinct on (resident_uid) resident_uid,evac_center_id,evac_status
      from public.evacuation_records order by resident_uid,logged_at desc nulls last,record_id desc
    ) latest where evac_center_id=p_center_id and evac_status::text in ('pending','in_transit','safely_evacuated');
    if blocked > 0 then raise exception 'Cannot close: % resident(s) have occupied, pending, or in-transit records. Resolve or transfer them first.',blocked; end if;
  elsif current_capacity is null or current_capacity < 1 then
    raise exception 'Set a reviewed safe capacity before reopening.';
  end if;
  update public.evacuation_centers set status=p_status, updated_at=clock_timestamp(),
    closed_at=case when p_status='closed' then clock_timestamp() else null end,
    closed_by=case when p_status='closed' then auth.uid() else null end,
    closure_reason=case when p_status='closed' then btrim(p_reason) else null end
    where center_id=p_center_id;
  insert into public.facility_status_audit(center_id,old_status,new_status,reason,changed_by)
    values(p_center_id,old_status,p_status,btrim(p_reason),auth.uid());
end;
$$;
revoke all on function public.change_evacuation_facility_status(integer,text,text,text) from public,anon;
grant execute on function public.change_evacuation_facility_status(integer,text,text,text) to authenticated;

create or replace function public.prevent_closed_center_admission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.evac_center_id is not null and new.evac_status::text in ('pending','in_transit','safely_evacuated')
    and exists(select 1 from public.evacuation_centers where center_id=new.evac_center_id and status='closed') then
    raise exception 'This evacuation center is closed. Select an active facility.';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_closed_center_admission() from public,anon,authenticated;
drop trigger if exists reject_closed_center_admission on public.evacuation_records;
create trigger reject_closed_center_admission before insert or update of evac_center_id,evac_status
on public.evacuation_records for each row execute function public.prevent_closed_center_admission();

create or replace function public.get_evacuation_facility_catalog()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_facility_admin();
  select coalesce(jsonb_agg(jsonb_build_object('center_id',center_id,'capacity',capacity,
    'occupied',public.recorded_facility_occupancy(center_id),'status',status,
    'closed_at',closed_at,'closure_reason',closure_reason) order by center_name),'[]'::jsonb)
    into result from public.evacuation_centers;
  return result;
end;
$$;
revoke all on function public.get_evacuation_facility_catalog() from public,anon;
grant execute on function public.get_evacuation_facility_catalog() to authenticated;
notify pgrst,'reload schema';
commit;
