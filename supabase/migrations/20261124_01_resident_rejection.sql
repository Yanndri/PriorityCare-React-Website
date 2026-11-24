-- Reject works even when a resident has no ID uploaded (e.g. seeded test residents).
-- The website stores the rejection on the resident row as well as on any ID records,
-- and clears it again when the resident is verified.
alter table public.residents add column if not exists verification_rejected_reason text;
alter table public.residents add column if not exists verification_rejected_at timestamptz;
