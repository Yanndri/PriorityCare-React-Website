-- PriorityCare: block privilege escalation through public.users
-- =================================================================
-- REVIEW BEFORE APPLYING. Not applied automatically.
--
-- Problem (verified 2026-10-14 against project urioaayowijvhwbuxxaj):
--   * Row Level Security is DISABLED on public.users.
--   * The anon and authenticated roles hold INSERT/UPDATE/DELETE/TRUNCATE.
--   * The publishable (anon) key ships in the frontend bundle.
--   => Anyone can run, from a browser console:
--        supabase.from('users').update({ role: 'super_admin' }).eq('uid', '<their uid>')
--      and then pass requireSuperAdmin in prioritycare-api/server.js,
--      the assert_*_admin() checks in earlier migrations, and the login
--      role checks. Backend authorization is only as strong as this table.
--
-- Why not simply enable RLS?
--   The existing Admin dashboard (src/api/dashboardApi.ts) uses the anon
--   client to update users.is_verified and delete resident rows. Turning on
--   RLS without policies for those flows would break verification. This
--   migration is the minimal, non-breaking fix: a trigger that lets client
--   roles keep doing what the app does today, but never touch the columns
--   that grant privileges, and never create/alter/delete admin accounts.
--
-- Effect:
--   anon / authenticated (browser, mobile app):
--     - INSERT: allowed only for non-admin roles with no assigned barangay
--       and account_status 'active' (resident/rescuer sign-up still works).
--     - UPDATE: may not change uid, role, account_status, or
--       assigned_barangay_id on any row; may not change an admin's or super
--       admin's email. is_verified and profile fields still work.
--     - DELETE: may not delete admin or super_admin rows.
--     - TRUNCATE: revoked (TRUNCATE bypasses row triggers).
--   service_role (prioritycare-api), postgres (SQL editor), and
--   SECURITY DEFINER functions owned by postgres: unaffected.
--
-- Non-destructive: no data, columns, or existing policies are changed.
-- Rollback:
--   drop trigger if exists users_privilege_guard on public.users;
--   drop function if exists public.guard_users_privileged_columns();
--   grant truncate on public.users, public.barangays to anon, authenticated;

create or replace function public.guard_users_privileged_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only requests made with the anon/authenticated API roles are restricted.
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.role::text in ('admin', 'super_admin')
       or new.assigned_barangay_id is not null
       or new.account_status is distinct from 'active' then
      raise exception 'Administrator accounts can only be created by the PriorityCare backend.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.uid is distinct from old.uid
       or new.role is distinct from old.role
       or new.account_status is distinct from old.account_status
       or new.assigned_barangay_id is distinct from old.assigned_barangay_id then
      raise exception 'Role, account status, and barangay assignment can only be changed by the PriorityCare backend.'
        using errcode = '42501';
    end if;

    if old.role::text in ('admin', 'super_admin')
       and new.email is distinct from old.email then
      raise exception 'Administrator emails can only be changed by the PriorityCare backend.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE
  if old.role::text in ('admin', 'super_admin') then
    raise exception 'Administrator accounts can only be removed by the PriorityCare backend.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_users_privileged_columns() from public, anon, authenticated;

drop trigger if exists users_privilege_guard on public.users;
create trigger users_privilege_guard
  before insert or update or delete on public.users
  for each row execute function public.guard_users_privileged_columns();

revoke truncate on table public.users from anon, authenticated;
revoke truncate on table public.barangays from anon, authenticated;
