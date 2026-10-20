-- PriorityCare: make the barangay the operational unit (was "sitio")
-- =================================================================
-- Decision (2026-10-19): sitios have no official boundary, so every
-- scoping, mapping and reporting unit becomes the BARANGAY. Sitio stays
-- only as a free-text address detail on residents and households so
-- rescuers and verifiers can find a home.
--
-- What this does, in one transaction:
--   1. Renames the table public.sitios -> public.barangays and every
--      column, table, constraint, index, sequence and policy whose name
--      says "sitio" (sitio_id -> barangay_id, assigned_sitio_id ->
--      assigned_barangay_id, sitio_shelter_plans -> barangay_shelter_plans,
--      ...). Row data, ids and foreign keys are kept as they are.
--   2. Adds barangay geography columns (PSGC code, centerpoint, area,
--      GeoJSON boundary). 20261019_02 fills them for Cordova's 13 barangays.
--   3. Adds a free-text "sitio" address column to residents and households.
--   4. Re-creates every public function whose definition says "sitio"
--      with the same body, "sitio" replaced by "barangay" (whole-word
--      prefix match only, so words like "position" or "transition" are
--      untouched). Function grants are re-applied exactly as before.
--      set_sitio_shelters -> set_barangay_shelters,
--      reunification_people.home_sitio(_id) -> home_barangay(_id), etc.
--   5. Renames "sitio" keys inside audit JSON (shelter-plan audit).
--
-- The web dashboard must be updated in the same release (same rename in
-- its code). The mobile app has no database code yet.
-- Rollback: restore from the pre-migration backup, or run the same
-- renames in reverse.

begin;

-- ---------------------------------------------------------------
-- 1. Renames
-- ---------------------------------------------------------------
do $$
declare
  r record;
begin
  -- tables
  for r in select c.relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname ~* 'sitio'
  loop
    execute format('alter table public.%I rename to %I', r.relname,
                   regexp_replace(regexp_replace(r.relname, 'sitio', 'barangay', 'g'), 'Sitio', 'Barangay', 'g'));
  end loop;

  -- columns
  for r in select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
             and a.attnum > 0 and not a.attisdropped and a.attname ~ 'sitio'
  loop
    execute format('alter table public.%I rename column %I to %I', r.relname, r.attname,
                   replace(r.attname, 'sitio', 'barangay'));
  end loop;

  -- constraints (renames their backing indexes too)
  for r in select c.relname, k.conname from pg_constraint k join pg_class c on c.oid = k.conrelid
           where c.relnamespace = 'public'::regnamespace and k.conname ~ 'sitio'
  loop
    execute format('alter table public.%I rename constraint %I to %I', r.relname, r.conname,
                   replace(r.conname, 'sitio', 'barangay'));
  end loop;

  -- remaining indexes and sequences
  for r in select c.relname, c.relkind from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('i', 'S') and c.relname ~ 'sitio'
  loop
    if r.relkind = 'i' then
      execute format('alter index public.%I rename to %I', r.relname, replace(r.relname, 'sitio', 'barangay'));
    else
      execute format('alter sequence public.%I rename to %I', r.relname, replace(r.relname, 'sitio', 'barangay'));
    end if;
  end loop;

  -- policy names
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname ~* 'sitio'
  loop
    execute format('alter policy %I on public.%I rename to %I', r.policyname, r.tablename,
                   replace(replace(r.policyname, 'sitio', 'barangay'), 'Sitio', 'Barangay'));
  end loop;
end $$;

-- ---------------------------------------------------------------
-- 2. Barangay geography
-- ---------------------------------------------------------------
alter table public.barangays
  add column if not exists psgc_code text unique,
  add column if not exists center_lat numeric(9, 6),
  add column if not exists center_lng numeric(9, 6),
  add column if not exists area_sqkm numeric(10, 6),
  add column if not exists boundary jsonb
    check (boundary is null or boundary ->> 'type' in ('Polygon', 'MultiPolygon'));

-- ---------------------------------------------------------------
-- 3. Sitio as a free-text address detail
-- ---------------------------------------------------------------
alter table public.residents
  add column if not exists sitio text not null default '' check (length(sitio) <= 100);
alter table public.households
  add column if not exists sitio text not null default '' check (length(sitio) <= 100);

-- ---------------------------------------------------------------
-- 4. Re-create functions with the new names
-- ---------------------------------------------------------------
do $$
declare
  r record;
  g record;
  new_def text;
  new_name text;
  targets oid[];
begin
  -- Collect the targets first: re-created functions must not be revisited.
  -- Case-sensitive word-start match, so "position"/"transition" don't count.
  select array_agg(p.oid) into targets
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~ '(^|[^a-z])sitio|Sitio|SITIO';

  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args,
           pg_get_functiondef(p.oid) as def, p.proacl
    from pg_proc p
    where p.oid = any (targets)
  loop
    new_def := r.def;
    new_def := replace(new_def, 'SITIO', 'BARANGAY');
    new_def := replace(new_def, 'Sitio', 'Barangay');
    -- lowercase only at the start of an identifier/word: keeps position, transition, requisition
    new_def := regexp_replace(new_def, '(^|[^a-z])sitio', '\1barangay', 'g');
    new_name := replace(r.proname, 'sitio', 'barangay');

    execute format('drop function public.%I(%s)', r.proname, r.args);
    execute new_def;

    -- re-apply the original EXECUTE grants
    -- (Supabase default privileges grant new functions to anon/authenticated/service_role)
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated, service_role', new_name,
                   replace(r.args, 'p_sitio', 'p_barangay'));
    if r.proacl is null then
      execute format('grant execute on function public.%I(%s) to public', new_name,
                     replace(r.args, 'p_sitio', 'p_barangay'));
    else
      for g in select a.grantee from aclexplode(r.proacl) a where a.privilege_type = 'EXECUTE'
      loop
        execute format('grant execute on function public.%I(%s) to %s', new_name,
                       replace(r.args, 'p_sitio', 'p_barangay'),
                       case when g.grantee = 0 then 'public' else quote_ident(g.grantee::regrole::text) end);
      end loop;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- 5. Audit JSON keys
-- ---------------------------------------------------------------
update public.barangay_shelter_plan_audit
set previous = case when previous is null then null
                    else regexp_replace(previous::text, '"sitio', '"barangay', 'g')::jsonb end,
    current = regexp_replace(current::text, '"sitio', '"barangay', 'g')::jsonb;

notify pgrst, 'reload schema';

commit;
