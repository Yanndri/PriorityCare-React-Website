-- File name kept from before the 2026-10-19 sitio -> barangay rename; content uses barangay.
-- PriorityCare: role- and barangay-scoped Row Level Security for staff
-- =================================================================
-- REVIEW BEFORE APPLYING. Not applied automatically.
-- Test on a Supabase branch or staging copy first.
--
-- Verified against project urioaayowijvhwbuxxaj on 2026-10-18:
--   * RLS is DISABLED on users, residents, verification_documents,
--     evacuation_records, resident_disabilities, barangays, evacuation_centers,
--     document_types and disability_types.
--   * Their existing policies are all USING (true) / WITH CHECK (true),
--     including "Allow anon delete users" and "Allow anon update users".
--   * anon and authenticated hold every table privilege (incl. TRUNCATE).
--   => With the public (publishable) key anyone can read every user's
--      contact number and PIN, make themselves super_admin, or delete data,
--      and an Admin can read and change any barangay's records.
--
-- What this migration does:
--   1. Adds three SECURITY DEFINER helpers that read the caller's role from
--      public.users (the trusted source) using auth.uid().
--   2. Replaces the "true" policies with:
--        Super Admin (active)  -> all barangays
--        Admin (active)        -> only residents of assigned_barangay_id
--        Resident              -> own rows (read; register own profile)
--        Rescuer               -> evacuation records they logged
--        anon (not signed in)  -> reference lists only (barangays, document
--                                 types, disability types, evacuation centers)
--   3. Removes client write access that the web app does not use
--      (role, barangay and status changes go through the backend API, which
--      uses the service role and re-checks Super Admin access).
--   4. Hides users.pin from every client role.
--
-- What it does NOT change:
--   * Existing SECURITY DEFINER RPCs (owner postgres, BYPASSRLS) keep working;
--     they already check admin/super admin and barangay themselves.
--   * households / resident_profile_details policies (already barangay-scoped).
--   * service_role (backend) access.
--   * No rows are deleted or modified.
--
-- BEFORE APPLYING, confirm the mobile/resident app:
--   * If it reads or writes these tables WITHOUT signing in through Supabase
--     Auth (anon key only), those calls will stop working.
--   * If it reads users.pin (e.g. PIN login), that read will be refused.
--   * If residents edit their own profile directly in public.users or
--     public.residents, that is refused (only registration is allowed);
--     it needs a dedicated RPC.
--
-- Rollback: see the end of this file.

begin;

-- ---------------------------------------------------------------
-- 1. Helpers (role from public.users, never from the client)
-- ---------------------------------------------------------------

create or replace function public.is_active_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.uid = auth.uid() and u.account_status = 'active' and u.role::text = 'super_admin'
  );
$$;

create or replace function public.staff_can_access_barangay(p_barangay integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.uid = auth.uid() and u.account_status = 'active'
      and (u.role::text = 'super_admin'
        or (u.role::text = 'admin' and u.assigned_barangay_id is not null and u.assigned_barangay_id = p_barangay))
  );
$$;

create or replace function public.staff_can_access_resident(p_resident uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.residents r
    where r.uid = p_resident and public.staff_can_access_barangay(r.barangay_id)
  );
$$;

create or replace function public.is_active_rescuer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.uid = auth.uid() and u.account_status = 'active' and u.role::text = 'rescuer'
  );
$$;

revoke all on function public.is_active_super_admin() from public, anon;
revoke all on function public.staff_can_access_barangay(integer) from public, anon;
revoke all on function public.staff_can_access_resident(uuid) from public, anon;
revoke all on function public.is_active_rescuer() from public, anon;
grant execute on function public.is_active_super_admin() to authenticated;
grant execute on function public.staff_can_access_barangay(integer) to authenticated;
grant execute on function public.staff_can_access_resident(uuid) to authenticated;
grant execute on function public.is_active_rescuer() to authenticated;

-- ---------------------------------------------------------------
-- 2. public.users
-- ---------------------------------------------------------------

drop policy if exists "Allow anon delete users" on public.users;
drop policy if exists "Allow anon update users" on public.users;
drop policy if exists "Allow anon verify pending users" on public.users;
drop policy if exists "Allow public operations on users" on public.users;

revoke all on public.users from anon;
revoke all on public.users from authenticated;

-- Every column except pin. Role, barangay and status are readable (needed to
-- route the signed-in user) but not writable from the client.
grant select (uid, role, email, f_name, m_name, l_name, contact_no, is_verified,
              created_at, assigned_barangay_id, account_status)
  on public.users to authenticated;
grant insert (uid, role, email, f_name, m_name, l_name, contact_no)
  on public.users to authenticated;
grant update (is_verified) on public.users to authenticated;
grant delete on public.users to authenticated;

-- The backend (service role) creates and manages Admin accounts.
grant select, insert, update, delete on public.users to service_role;

alter table public.users enable row level security;

drop policy if exists users_select_own_or_staff on public.users;
create policy users_select_own_or_staff on public.users
  for select to authenticated
  using (
    uid = auth.uid()
    or public.is_active_super_admin()
    or (role::text = 'resident' and public.staff_can_access_resident(uid))
  );

-- Resident self-registration only: own uid, resident role, no barangay
-- assignment, active, not pre-verified (column defaults apply).
drop policy if exists users_insert_own_resident on public.users;
create policy users_insert_own_resident on public.users
  for insert to authenticated
  with check (
    uid = auth.uid() and role::text = 'resident'
    and assigned_barangay_id is null and account_status = 'active'
    and coalesce(is_verified, false) = false
  );

-- Verify / reject residents of the caller's barangay (only is_verified is
-- granted, so nothing else can change).
drop policy if exists users_update_staff_verification on public.users;
create policy users_update_staff_verification on public.users
  for update to authenticated
  using (role::text = 'resident' and public.staff_can_access_resident(uid))
  with check (role::text = 'resident' and public.staff_can_access_resident(uid));

drop policy if exists users_delete_staff_residents on public.users;
create policy users_delete_staff_residents on public.users
  for delete to authenticated
  using (role::text = 'resident' and public.staff_can_access_resident(uid));

-- ---------------------------------------------------------------
-- 3. public.residents
-- ---------------------------------------------------------------

drop policy if exists "Allow anon delete residents" on public.residents;
drop policy if exists "Allow anon update residents" on public.residents;
drop policy if exists "Allow public operations on residents" on public.residents;

revoke all on public.residents from anon;
revoke truncate, references, trigger on public.residents from authenticated;
grant select, insert, update, delete on public.residents to authenticated;

alter table public.residents enable row level security;

drop policy if exists residents_select on public.residents;
create policy residents_select on public.residents
  for select to authenticated
  using (uid = auth.uid() or public.staff_can_access_barangay(barangay_id));

drop policy if exists residents_insert_own on public.residents;
create policy residents_insert_own on public.residents
  for insert to authenticated
  with check (uid = auth.uid());

drop policy if exists residents_update_staff on public.residents;
create policy residents_update_staff on public.residents
  for update to authenticated
  using (public.staff_can_access_barangay(barangay_id))
  with check (public.staff_can_access_barangay(barangay_id));

drop policy if exists residents_delete_staff on public.residents;
create policy residents_delete_staff on public.residents
  for delete to authenticated
  using (public.staff_can_access_barangay(barangay_id));

-- ---------------------------------------------------------------
-- 4. public.verification_documents
-- ---------------------------------------------------------------

drop policy if exists "Allow anon delete verification documents" on public.verification_documents;
drop policy if exists "Allow anon update verification documents" on public.verification_documents;
drop policy if exists "Allow public operations on verification docs" on public.verification_documents;

revoke all on public.verification_documents from anon;
revoke truncate, references, trigger on public.verification_documents from authenticated;
grant select, insert, update, delete on public.verification_documents to authenticated;

alter table public.verification_documents enable row level security;

drop policy if exists verification_documents_select on public.verification_documents;
create policy verification_documents_select on public.verification_documents
  for select to authenticated
  using (uid = auth.uid() or public.staff_can_access_resident(uid));

drop policy if exists verification_documents_insert_own on public.verification_documents;
create policy verification_documents_insert_own on public.verification_documents
  for insert to authenticated
  with check (uid = auth.uid());

drop policy if exists verification_documents_update_staff on public.verification_documents;
create policy verification_documents_update_staff on public.verification_documents
  for update to authenticated
  using (public.staff_can_access_resident(uid))
  with check (public.staff_can_access_resident(uid));

drop policy if exists verification_documents_delete_staff on public.verification_documents;
create policy verification_documents_delete_staff on public.verification_documents
  for delete to authenticated
  using (public.staff_can_access_resident(uid));

-- ---------------------------------------------------------------
-- 5. public.evacuation_records
-- ---------------------------------------------------------------

drop policy if exists "Allow anon delete evacuation records" on public.evacuation_records;
drop policy if exists "Allow public operations on evac records" on public.evacuation_records;

revoke all on public.evacuation_records from anon;
revoke truncate, references, trigger on public.evacuation_records from authenticated;
grant select, insert, update, delete on public.evacuation_records to authenticated;

alter table public.evacuation_records enable row level security;

drop policy if exists evacuation_records_select on public.evacuation_records;
create policy evacuation_records_select on public.evacuation_records
  for select to authenticated
  using (
    resident_uid = auth.uid()
    or (rescuer_uid = auth.uid() and public.is_active_rescuer())
    or public.staff_can_access_resident(resident_uid)
  );

drop policy if exists evacuation_records_insert on public.evacuation_records;
create policy evacuation_records_insert on public.evacuation_records
  for insert to authenticated
  with check (
    (rescuer_uid = auth.uid() and public.is_active_rescuer())
    or public.staff_can_access_resident(resident_uid)
  );

drop policy if exists evacuation_records_update on public.evacuation_records;
create policy evacuation_records_update on public.evacuation_records
  for update to authenticated
  using (
    (rescuer_uid = auth.uid() and public.is_active_rescuer())
    or public.staff_can_access_resident(resident_uid)
  )
  with check (
    (rescuer_uid = auth.uid() and public.is_active_rescuer())
    or public.staff_can_access_resident(resident_uid)
  );

drop policy if exists evacuation_records_delete_staff on public.evacuation_records;
create policy evacuation_records_delete_staff on public.evacuation_records
  for delete to authenticated
  using (public.staff_can_access_resident(resident_uid));

-- ---------------------------------------------------------------
-- 6. public.resident_disabilities
-- ---------------------------------------------------------------

drop policy if exists "Allow public operations on disabilities" on public.resident_disabilities;

revoke all on public.resident_disabilities from anon;
revoke truncate, references, trigger on public.resident_disabilities from authenticated;
grant select, insert, update, delete on public.resident_disabilities to authenticated;

alter table public.resident_disabilities enable row level security;

drop policy if exists resident_disabilities_select on public.resident_disabilities;
create policy resident_disabilities_select on public.resident_disabilities
  for select to authenticated
  using (resident_uid = auth.uid() or public.staff_can_access_resident(resident_uid));

drop policy if exists resident_disabilities_write on public.resident_disabilities;
create policy resident_disabilities_write on public.resident_disabilities
  for all to authenticated
  using (resident_uid = auth.uid() or public.staff_can_access_resident(resident_uid))
  with check (resident_uid = auth.uid() or public.staff_can_access_resident(resident_uid));

-- ---------------------------------------------------------------
-- 7. Reference lists: readable by everyone, writable by nobody from the
--    client. Evacuation centers are changed through the existing
--    facility RPCs; barangays/types through the backend or SQL.
-- ---------------------------------------------------------------

drop policy if exists "Allow anon read barangays" on public.barangays;
drop policy if exists "Allow public operations on barangays" on public.barangays;
drop policy if exists "Allow anon read evacuation centers" on public.evacuation_centers;
drop policy if exists "Allow public operations on evac centers" on public.evacuation_centers;

revoke all on public.barangays, public.evacuation_centers, public.document_types, public.disability_types
  from anon, authenticated;
grant select on public.barangays, public.evacuation_centers, public.document_types, public.disability_types
  to anon, authenticated;
grant select on public.barangays to service_role;

alter table public.barangays enable row level security;
alter table public.evacuation_centers enable row level security;
alter table public.document_types enable row level security;
alter table public.disability_types enable row level security;

drop policy if exists barangays_read on public.barangays;
create policy barangays_read on public.barangays for select to anon, authenticated using (true);
drop policy if exists evacuation_centers_read on public.evacuation_centers;
create policy evacuation_centers_read on public.evacuation_centers for select to anon, authenticated using (true);
drop policy if exists document_types_read on public.document_types;
create policy document_types_read on public.document_types for select to anon, authenticated using (true);
drop policy if exists disability_types_read on public.disability_types;
create policy disability_types_read on public.disability_types for select to anon, authenticated using (true);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------
-- ROLLBACK (only if the app breaks after applying; restores the previous,
-- insecure state - prefer fixing the specific policy instead):
--
-- begin;
-- alter table public.users disable row level security;
-- alter table public.residents disable row level security;
-- alter table public.verification_documents disable row level security;
-- alter table public.evacuation_records disable row level security;
-- alter table public.resident_disabilities disable row level security;
-- alter table public.barangays disable row level security;
-- alter table public.evacuation_centers disable row level security;
-- alter table public.document_types disable row level security;
-- alter table public.disability_types disable row level security;
-- grant all on public.users, public.residents, public.verification_documents,
--   public.evacuation_records, public.resident_disabilities, public.barangays,
--   public.evacuation_centers, public.document_types, public.disability_types
--   to anon, authenticated;
-- commit;
