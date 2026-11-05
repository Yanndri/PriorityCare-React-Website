-- STEP 15: lets the app tell a resident on the first sign-up step that their
-- mobile number is already registered (instead of only at the very end).
-- Answers true/false only; it never returns whose number it is.
create or replace function public.is_contact_registered(p_contact text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from auth.users
           where email = public.resident_login_email(p_contact))
      or exists (
           select 1 from public.users
           where public.normalize_contact_no(contact_no) = public.normalize_contact_no(p_contact))
$$;

revoke all on function public.is_contact_registered(text) from public;
grant execute on function public.is_contact_registered(text) to anon, authenticated, service_role;
