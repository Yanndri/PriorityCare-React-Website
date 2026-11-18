-- STEP 29: the resident says how many people are with them when sending an SOS (user decision 2026-11-18).
-- raise_sos gains p_headcount (1-50). Left out, it still counts the whole registered household.
-- The old 4-input version is dropped so the app's call is never ambiguous.
-- Run in the Supabase SQL Editor. Safe to run twice.

begin;

drop function if exists public.raise_sos(text, numeric, numeric, text);

create or replace function public.raise_sos(p_type text, p_lat numeric, p_lng numeric, p_note text,
                                            p_headcount integer default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare r public.residents; v_household uuid;
begin
  select * into r from public.residents where uid = auth.uid();
  if not found then raise exception 'Only registered residents can send an SOS.'; end if;
  if not exists (select 1 from public.users where uid = auth.uid() and account_status = 'active') then
    raise exception 'This account is not active.';
  end if;
  if upper(coalesce(p_type, '')) not in ('FLOOD', 'FIRE', 'MEDICAL', 'TRAPPED', 'OTHER') then
    raise exception 'Choose the type of emergency.';
  end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Send both coordinates or neither.'; end if;
  if p_headcount is not null and (p_headcount < 1 or p_headcount > 50) then
    raise exception 'People with you must be between 1 and 50.';
  end if;
  -- One live SOS per resident: pressing again just returns the current one.
  if not exists (select 1 from public.sos_alerts where resident_uid = auth.uid() and status = 'active') then
    v_household := public.resident_household_id(auth.uid());
    insert into public.sos_alerts (resident_uid, household_id, barangay_id, home_barangay_id, alert_type, alert_level,
                                   latitude, longitude, headcount, note, status)
    values (auth.uid(), v_household, coalesce(public.barangay_at(p_lat, p_lng), r.barangay_id), r.barangay_id,
            upper(p_type), public.household_alert_level(auth.uid()),
            coalesce(p_lat, r.gps_lat), coalesce(p_lng, r.gps_long),
            coalesce(p_headcount, 1 + (select count(*) from public.household_members m where m.household_id = v_household)),
            left(btrim(coalesce(p_note, '')), 500), 'active');
  end if;
  return public.get_my_sos();
end;
$function$;

revoke all on function public.raise_sos(text, numeric, numeric, text, integer) from public, anon;
grant execute on function public.raise_sos(text, numeric, numeric, text, integer) to authenticated;

commit;
