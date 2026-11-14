-- The backend inserts and renews accreditation using the Supabase service role.
-- The renewal upsert also needs SELECT on the conflict key. Keep client access
-- unchanged: the roster is read through the guarded list_responders RPC.
grant select, insert, update on table public.responder_accreditations to service_role;
