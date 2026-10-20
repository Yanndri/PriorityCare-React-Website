-- Module: Resident Profile Archiving & Status Deactivation.
-- Staff can deactivate a resident (sign-in and app actions stop, the profile stays visible) or
-- archive one (also deactivated, and hidden from the active resident lists). Both keep every
-- SOS, evacuation, dispatch and missing-person record, unlike delete_resident_account, which
-- refuses residents with history. Both can be undone.
-- Deactivation reuses users.account_status = 'suspended' (as for suspended staff and rescuers), so every
-- database check that requires an active account, such as is_active_user(), now refuses the resident.
-- Archiving adds archived_at; the reason, time and staff member are kept for both.
begin;

alter table public.users
  add column if not exists status_reason text check (char_length(status_reason) <= 500),
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.users(uid) on delete set null,
  add column if not exists archived_at timestamptz;

-- public.users uses column-level SELECT grants, so new columns must be granted
-- explicitly or the dashboard's users query fails with "permission denied".
grant select (status_reason, status_changed_at, status_changed_by, archived_at) on public.users to authenticated;

-- Residents may edit their own users row, so keep these columns out of their reach,
-- the same way users_privilege_guard protects account_status.
create or replace function public.guard_users_archive_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.status_reason is distinct from old.status_reason
    or new.status_changed_at is distinct from old.status_changed_at
    or new.status_changed_by is distinct from old.status_changed_by
    or new.archived_at is distinct from old.archived_at) then
    raise exception 'Account status details can only be changed by PriorityCare staff tools.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_users_archive_columns() from public, anon, authenticated;

drop trigger if exists users_archive_guard on public.users;
create trigger users_archive_guard
  before update on public.users
  for each row execute function public.guard_users_archive_columns();

-- p_action: 'deactivate' | 'reactivate' | 'archive' | 'restore'.
-- 'reactivate' and 'restore' both return the account to active and clear the archive.
create or replace function public.set_resident_account_state(p_uid uuid, p_action text, p_reason text default null)
returns table (account_status text, archived_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  target public.users%rowtype;
begin
  if not public.is_active_staff() then
    raise exception 'Active administrator access is required.' using errcode = '42501';
  end if;
  select * into target from public.users u where u.uid = p_uid and u.role::text = 'resident' for update;
  if not found then
    raise exception 'Resident not found.';
  end if;
  if not public.staff_can_access_resident(p_uid) then
    raise exception 'This resident is not in your authorized barangay.' using errcode = '42501';
  end if;
  if p_action in ('deactivate', 'archive') and reason is null then
    raise exception 'Please give a reason.';
  end if;
  if char_length(reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer.';
  end if;

  if p_action = 'deactivate' then
    if target.archived_at is not null then raise exception 'This resident is archived. Restore the profile instead.'; end if;
    if target.account_status::text = 'suspended' then raise exception 'This resident is already deactivated.'; end if;
    update public.users u set account_status = 'suspended', status_reason = reason,
      status_changed_at = now(), status_changed_by = auth.uid()
    where u.uid = p_uid;
  elsif p_action = 'archive' then
    if target.archived_at is not null then raise exception 'This resident is already archived.'; end if;
    update public.users u set account_status = 'suspended', archived_at = now(), status_reason = reason,
      status_changed_at = now(), status_changed_by = auth.uid()
    where u.uid = p_uid;
  elsif p_action in ('reactivate', 'restore') then
    if target.account_status::text = 'active' and target.archived_at is null then
      raise exception 'This resident is already active.';
    end if;
    update public.users u set account_status = 'active', archived_at = null, status_reason = reason,
      status_changed_at = now(), status_changed_by = auth.uid()
    where u.uid = p_uid;
  else
    raise exception 'Unknown action: %', p_action;
  end if;

  return query select u.account_status::text, u.archived_at from public.users u where u.uid = p_uid;
end;
$$;
revoke all on function public.set_resident_account_state(uuid, text, text) from public, anon;
grant execute on function public.set_resident_account_state(uuid, text, text) to authenticated;

commit;
