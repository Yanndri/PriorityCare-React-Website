-- Staff who register a resident on the website can attach the ID they checked in person:
-- ID type, ID number and an optional photo. The photo goes to verification-docs/<resident uid>/.

-- Upload into a resident's folder, only for residents the staff member may access.
create policy prioritycare_staff_upload_verification on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.staff_can_access_resident(((storage.foldername(name))[1])::uuid)
  );

-- Save the ID record. p_path may be '' when there is no photo. p_approved = staff checked it in person.
create or replace function public.staff_add_verification_document(
  p_uid uuid, p_type_id integer, p_id_number text, p_path text default '', p_approved boolean default true)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare v_doc integer;
begin
  if not public.staff_can_access_resident(p_uid) then
    raise exception 'This resident is not in your barangay.';
  end if;
  if not exists (select 1 from public.document_types where type_id = p_type_id) then
    raise exception 'Unknown ID type.';
  end if;
  if coalesce(p_path, '') <> '' and p_path not like p_uid::text || '/%' then
    raise exception 'The ID photo must be in the resident''s folder.';
  end if;
  insert into public.verification_documents (uid, type_id, file_url, id_number, review_status, reviewed_by, reviewed_at)
  values (p_uid, p_type_id, coalesce(p_path, ''), left(btrim(coalesce(p_id_number, '')), 100),
          case when p_approved then 'approved' else 'pending' end::public.review_status_type,
          case when p_approved then auth.uid() end,
          case when p_approved then now() end)
  returning doc_id into v_doc;
  return v_doc;
end;
$$;

revoke all on function public.staff_add_verification_document(uuid, integer, text, text, boolean) from public, anon;
grant execute on function public.staff_add_verification_document(uuid, integer, text, text, boolean) to authenticated;
