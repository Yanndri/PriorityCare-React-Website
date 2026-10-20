-- Step 8: responder accounts carry their community disaster volunteer accreditation.
-- RA 10121 Sec. 13 and NDRRMC Memorandum Circular No. 64 s. 2021 (amended by MC No. 02 s. 2024):
-- volunteers are accredited and issued IDs at the municipal or city level through the LDRRMO, and are
-- mobilized by the organization that fields them. So only the municipal admin creates rescuer accounts
-- (prioritycare-api POST /api/super-admin/rescuers), and only rescuers with current accreditation can be
-- added to a rescue unit.
-- NDRRMP 2020-2030 activity 11.1.1 and Outcome 13 call for a database of accredited community disaster
-- volunteers and a protected, well-equipped workforce, so the roster also keeps trainings and insurance.
begin;

create table if not exists public.responder_accreditations (
  uid uuid primary key references public.users(uid) on delete cascade,
  accreditation_no text not null unique check (length(btrim(accreditation_no)) between 3 and 50),
  organization text not null check (length(btrim(organization)) between 2 and 150),
  accredited_on date not null,
  valid_until date not null,
  -- e.g. Basic Life Support, WASAR, Collapsed Structure Search and Rescue, ICS
  trainings text[] not null default '{}' check (cardinality(trainings) <= 20),
  -- Personal accident insurance for volunteers (RA 10121 Sec. 13).
  insurance_ref text check (insurance_ref is null or length(insurance_ref) <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (valid_until > accredited_on)
);
alter table public.responder_accreditations enable row level security;
revoke all on public.responder_accreditations from anon, authenticated;

-- Test rescuers (TEST_LOGINS.md).
insert into public.responder_accreditations(uid, accreditation_no, organization, accredited_on, valid_until)
select u.uid, v.no, v.org, date '2026-01-15', date '2028-01-14'
from (values ('rescuer.alegria@prioritycare.local', 'CDV-CORDOVA-2026-0001', 'Alegria BDRRMC Emergency Response Team'),
             ('rescuer.buagsong@prioritycare.local', 'CDV-CORDOVA-2026-0002', 'Buagsong BDRRMC Emergency Response Team')) v(email, no, org)
join public.users u on u.email = v.email and u.role::text = 'rescuer'
on conflict (uid) do nothing;

create or replace function public.responder_is_deployable(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.users u join public.responder_accreditations a on a.uid = u.uid
    where u.uid = p_uid and u.role::text = 'rescuer' and u.account_status = 'active'
      and a.valid_until >= (now() at time zone 'Asia/Manila')::date)
$$;
revoke all on function public.responder_is_deployable(uuid) from public, anon, authenticated;

-- Newly added unit members must hold current accreditation. Members already on a unit are not re-checked,
-- so renaming a unit still works; the board shows whose accreditation has lapsed.
create or replace function public.check_unit_member_accreditation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare bad text;
begin
  select string_agg(coalesce(nullif(concat_ws(' ', u.f_name, u.l_name), ''), m::text), ', ') into bad
  from unnest(coalesce(new.member_uids, '{}')) m
  left join public.users u on u.uid = m
  where not (tg_op = 'UPDATE' and m = any(coalesce(old.member_uids, '{}')))
    and not public.responder_is_deployable(m);
  if bad is not null then
    raise exception 'Not deployable: % (needs an active rescuer account with current CDV accreditation).', bad;
  end if;
  return new;
end;
$$;
revoke all on function public.check_unit_member_accreditation() from public, anon, authenticated;
drop trigger if exists rescue_unit_members_accredited on public.rescue_units;
create trigger rescue_unit_members_accredited before insert or update of member_uids on public.rescue_units
  for each row execute function public.check_unit_member_accreditation();

-- Responder roster. Municipal admins see everyone; barangay admins see responders assigned to their
-- barangay or serving on one of its units.
create or replace function public.list_responders()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_super boolean; actor_barangay integer;
begin
  perform public.assert_facility_admin();
  select is_super, barangay_id into actor_super, actor_barangay from public.facility_actor();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'uid', u.uid, 'name', concat_ws(' ', u.f_name, u.m_name, u.l_name), 'f_name', u.f_name, 'm_name', u.m_name,
      'l_name', u.l_name, 'email', u.email, 'contact_no', u.contact_no, 'account_status', u.account_status,
      'barangay_id', u.assigned_barangay_id, 'barangay_name', b.barangay_name,
      'accreditation_no', a.accreditation_no, 'organization', a.organization,
      'accredited_on', a.accredited_on, 'valid_until', a.valid_until,
      'trainings', coalesce(to_jsonb(a.trainings), '[]'::jsonb), 'insurance_ref', a.insurance_ref,
      'deployable', public.responder_is_deployable(u.uid),
      'units', (select coalesce(jsonb_agg(un.unit_name order by un.unit_name), '[]'::jsonb)
                from public.rescue_units un where u.uid = any(un.member_uids))
    ) order by u.l_name, u.f_name), '[]'::jsonb)
    from public.users u
    left join public.barangays b on b.barangay_id = u.assigned_barangay_id
    left join public.responder_accreditations a on a.uid = u.uid
    where u.role::text = 'rescuer'
      and (actor_super or u.assigned_barangay_id = actor_barangay
           or exists(select 1 from public.rescue_units un where un.barangay_id = actor_barangay and u.uid = any(un.member_uids))));
end;
$$;
revoke all on function public.list_responders() from public, anon;
grant execute on function public.list_responders() to authenticated;

commit;
