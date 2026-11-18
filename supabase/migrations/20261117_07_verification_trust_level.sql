-- STEP 26: resident verification = trust level (user decision 2026-11-17). SOS is never blocked.
-- 1. Waiting hazard reports: verified residents up to 3 at once, unverified residents 1.
-- 2. The alarm level (2nd/3rd alarm) only counts "I see it too" and repeat reports from
--    verified residents, responders and staff, so fake accounts cannot push a false alarm up.
-- 3. get_hazard_reporters also says whether the reporter is verified (for the "Account not verified" tag).
-- Run in the Supabase SQL Editor. Safe to run twice.

begin;

-- Trusted = not a resident (responder/staff), or a verified resident.
create or replace function public.is_trusted_reporter(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select u.role::text <> 'resident' or coalesce(u.is_verified, false)
                     from public.users u where u.uid = p_uid), false)
$$;
revoke all on function public.is_trusted_reporter(uuid) from public, anon;
grant execute on function public.is_trusted_reporter(uuid) to authenticated;

-- 1. Limit (replaces STEP25's flat 3).
create or replace function public.limit_resident_open_hazards()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_limit integer; v_open integer;
begin
  if new.reporter_role <> 'resident' then return new; end if;
  v_limit := case when public.is_trusted_reporter(new.reported_by) then 3 else 1 end;
  select count(*) into v_open from public.hazard_reports
   where reported_by = new.reported_by and status in ('unverified', 'under_review');
  if v_open >= v_limit then
    if v_limit = 1 then
      raise exception 'You already have a report waiting to be checked. Unverified accounts can have 1 at a time: visit your barangay hall to get verified (verified accounts can have 3), or take back the one you sent (Hazards > My reports).';
    else
      raise exception 'You already have 3 reports waiting to be checked. Wait for them to be checked, or take back one you sent by mistake (Hazards > My reports).';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger limit_resident_open_hazards
  before insert on public.hazard_reports
  for each row execute function public.limit_resident_open_hazards();

-- 2. Alarm level counts trusted people only.
create or replace function public.get_hazard_alarms()
 returns table(hazard_id uuid, alarm_level integer, confirmations integer, nearby_reports integer, confirmed_by_me boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select h.hazard_id,
         1 + c.n + nb.n,
         c.n, nb.n,
         exists (select 1 from public.hazard_confirmations x where x.hazard_id = h.hazard_id and x.uid = auth.uid())
  from public.hazard_reports h
  cross join lateral (select count(*)::integer n from public.hazard_confirmations x
                       where x.hazard_id = h.hazard_id and public.is_trusted_reporter(x.uid)) c
  cross join lateral (
    select count(*)::integer n from public.hazard_reports o
    where o.hazard_id <> h.hazard_id and o.hazard_type = h.hazard_type
      and o.status in ('unverified', 'under_review', 'confirmed')
      and o.reported_by is distinct from h.reported_by
      and public.is_trusted_reporter(o.reported_by)
      and abs(extract(epoch from (o.created_at - h.created_at))) <= 6 * 3600
      and public.distance_m(o.latitude, o.longitude, h.latitude, h.longitude) <= 300) nb
  where h.status in ('unverified', 'under_review', 'confirmed')
    and exists (select 1 from public.users where uid = auth.uid() and account_status = 'active')
$function$;

-- 3. Reporter details now include whether the reporter is verified (return type changes, so drop first).
drop function if exists public.get_hazard_reporters(uuid[]);
create function public.get_hazard_reporters(p_ids uuid[])
returns table (hazard_id uuid, reporter_name text, reporter_role text, contact_no text, reporter_verified boolean)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not (public.is_active_rescuer() or public.is_active_staff()) then
    raise exception 'Only responders and staff can see who reported a hazard.' using errcode = '42501';
  end if;
  return query
    select z.hazard_id, nullif(concat_ws(' ', u.f_name, u.l_name), ''), z.reporter_role, u.contact_no::text,
           public.is_trusted_reporter(z.reported_by)
      from public.hazard_reports z
      left join public.users u on u.uid = z.reported_by
     where z.hazard_id = any(p_ids)
       and (public.is_active_rescuer() or public.staff_can_access_barangay(z.barangay_id));
end;
$$;
revoke all on function public.get_hazard_reporters(uuid[]) from public, anon;
grant execute on function public.get_hazard_reporters(uuid[]) to authenticated;

commit;
