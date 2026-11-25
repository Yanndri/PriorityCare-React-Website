-- Staff can remove an ID a resident (or staff) uploaded by mistake: the record and its photo.
-- Who removed which ID, and when, is kept in verification_document_removals and shown in the
-- Activity Log (get_operational_timeline), because the deleted row's own entries disappear.
-- Safe to run more than once.

create table if not exists public.verification_document_removals (
  removal_id    bigint generated always as identity primary key,
  doc_id        integer not null,
  uid           uuid not null,
  type_name     text,
  review_status text,
  file_url      text,
  removed_by    uuid,
  removed_at    timestamptz not null default now()
);
alter table public.verification_document_removals enable row level security;
revoke all on public.verification_document_removals from anon, authenticated;

-- Returns the photo's storage path ('' when there was none) so the website can delete the file.
create or replace function public.staff_remove_verification_document(p_doc_id integer)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare v public.verification_documents; v_type text;
begin
  select * into v from public.verification_documents where doc_id = p_doc_id;
  if not found then raise exception 'This ID was already removed.'; end if;
  if not public.staff_can_access_resident(v.uid) then
    raise exception 'This resident is not in your barangay.';
  end if;
  select type_name into v_type from public.document_types where type_id = v.type_id;
  insert into public.verification_document_removals (doc_id, uid, type_name, review_status, file_url, removed_by)
  values (v.doc_id, v.uid, v_type, v.review_status::text, v.file_url, auth.uid());
  delete from public.verification_documents where doc_id = p_doc_id;
  return coalesce(v.file_url, '');
end;
$$;
revoke all on function public.staff_remove_verification_document(integer) from public, anon;
grant execute on function public.staff_remove_verification_document(integer) to authenticated;

-- Staff may delete photos in the folder of a resident they can access.
drop policy if exists prioritycare_staff_delete_verification on storage.objects;
create policy prioritycare_staff_delete_verification on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.staff_can_access_resident(((storage.foldername(name))[1])::uuid)
  );

-- Activity Log: add "Verification document removed" next to uploads and reviews.
do $do$
declare v_def text; v_block text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_operational_timeline';
  if v_def is null or position('Verification document removed' in v_def) > 0 then return; end if;
  v_block := $b$  (select x.removed_at, 'verification', 'Verification document removed',
         concat_ws(' ', u.f_name, u.l_name), r.barangay_id, x.review_status, 'removed', x.removed_by,
         'Document: ' || coalesce(x.type_name, 'unknown type'), x.doc_id::text
  from public.verification_document_removals x
  join public.users u on u.uid = x.uid
  left join public.residents r on r.uid = x.uid
  where x.removed_at >= p_from and x.removed_at < p_to
    and (actor_role = 'super_admin' or r.barangay_id = actor_barangay))
  union all
$b$;
  if position('  -- 7. SOS alerts raised' in v_def) = 0 then
    raise notice 'Activity Log not updated: section marker not found.';
    return;
  end if;
  execute replace(v_def, '  -- 7. SOS alerts raised', v_block || '  -- 7. SOS alerts raised');
end;
$do$;
