-- STEP 30: the resident ticks which household members are with them when sending an SOS
-- (user decision 2026-11-18). Priority and equipment then use only the people actually there.
--   * sos_alert_members: one row per household member who is with the resident (link table, no arrays).
--   * sos_alerts.members_listed: true when the resident gave the list (older SOS = whole household).
--   * raise_sos gains p_with_members uuid[] (members not in the caller's household are ignored).
--   * get_ticket_sos_members(ticket ids): what the responder app reads for its own tickets.
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run twice.

begin;

alter table public.sos_alerts add column if not exists members_listed boolean not null default false;

create table if not exists public.sos_alert_members (
  alert_id  uuid not null references public.sos_alerts(alert_id) on delete cascade,
  member_id uuid not null references public.household_members(member_id) on delete cascade,
  primary key (alert_id, member_id)
);
alter table public.sos_alert_members enable row level security;
-- Whoever can see the SOS can see who is with the resident (the sos_alerts policy decides).
drop policy if exists sos_alert_members_read on public.sos_alert_members;
create policy sos_alert_members_read on public.sos_alert_members for select to authenticated
  using (exists (select 1 from public.sos_alerts a where a.alert_id = sos_alert_members.alert_id));
revoke all on public.sos_alert_members from anon;
grant select on public.sos_alert_members to authenticated;

drop function if exists public.raise_sos(text, numeric, numeric, text);
drop function if exists public.raise_sos(text, numeric, numeric, text, integer);

create or replace function public.raise_sos(p_type text, p_lat numeric, p_lng numeric, p_note text,
                                            p_headcount integer default null, p_with_members uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare r public.residents; v_household uuid; v_alert uuid; v_members uuid[];
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
    if p_with_members is not null then
      select coalesce(array_agg(m.member_id), '{}') into v_members
        from public.household_members m where m.household_id = v_household and m.member_id = any(p_with_members);
    end if;
    insert into public.sos_alerts (resident_uid, household_id, barangay_id, home_barangay_id, alert_type, alert_level,
                                   latitude, longitude, headcount, members_listed, note, status)
    values (auth.uid(), v_household, coalesce(public.barangay_at(p_lat, p_lng), r.barangay_id), r.barangay_id,
            upper(p_type), public.household_alert_level(auth.uid()),
            coalesce(p_lat, r.gps_lat), coalesce(p_lng, r.gps_long),
            -- Never fewer than the resident plus the members they ticked.
            greatest(coalesce(p_headcount, 1 + coalesce(cardinality(v_members),
                       (select count(*) from public.household_members m where m.household_id = v_household)::int)),
                     1 + coalesce(cardinality(v_members), 0)),
            v_members is not null,
            left(btrim(coalesce(p_note, '')), 500), 'active')
    returning alert_id into v_alert;
    if v_members is not null then
      insert into public.sos_alert_members (alert_id, member_id) select v_alert, unnest(v_members);
    end if;
  end if;
  return public.get_my_sos();
end;
$function$;

revoke all on function public.raise_sos(text, numeric, numeric, text, integer, uuid[]) from public, anon;
grant execute on function public.raise_sos(text, numeric, numeric, text, integer, uuid[]) to authenticated;

-- For the responder app: per ticket, whether the resident listed who is with them, and who.
create or replace function public.get_ticket_sos_members(p_ticket_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_object_agg(t.ticket_id, jsonb_build_object(
           'listed', a.members_listed,
           'member_ids', (select coalesce(jsonb_agg(sm.member_id), '[]'::jsonb)
                          from public.sos_alert_members sm where sm.alert_id = a.alert_id))), '{}'::jsonb)
  from public.dispatch_tickets t
  join public.sos_alerts a on t.source = 'sos' and a.alert_id::text = t.source_ref::text
  where t.ticket_id = any(p_ticket_ids)
    and (public.is_active_rescuer() or public.is_active_staff());
$function$;

revoke all on function public.get_ticket_sos_members(uuid[]) from public, anon;
grant execute on function public.get_ticket_sos_members(uuid[]) to authenticated;

commit;
