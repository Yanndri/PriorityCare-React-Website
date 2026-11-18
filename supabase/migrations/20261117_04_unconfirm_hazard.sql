-- STEP 23: take back an "I see it too" pressed by mistake (2026-11-17).
-- Removes only your own confirmation, so the hazard's alarm level drops back.
-- Run in the Supabase SQL Editor. Safe to run twice.

begin;

create or replace function public.unconfirm_hazard(p_hazard_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from public.hazard_confirmations where hazard_id = p_hazard_id and uid = auth.uid();
end;
$$;

revoke all on function public.unconfirm_hazard(uuid) from public, anon;
grant execute on function public.unconfirm_hazard(uuid) to authenticated;

commit;
