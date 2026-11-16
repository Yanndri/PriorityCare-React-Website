-- Step 14 (2026-11-04): official sitio list per barangay.
-- Barangay staff keep the list on the web (Sitios page); residents pick from it in the app
-- instead of typing. residents.sitio / households.sitio still store the chosen name as text.
begin;

create table if not exists public.sitios (
  sitio_id bigint generated always as identity primary key,
  barangay_id integer not null references public.barangays(barangay_id) on delete cascade,
  sitio_name text not null check (length(btrim(sitio_name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index if not exists sitios_unique_name on public.sitios (barangay_id, lower(btrim(sitio_name)));

alter table public.sitios enable row level security;
drop policy if exists sitios_read on public.sitios;
create policy sitios_read on public.sitios for select to anon, authenticated using (true);
drop policy if exists sitios_staff_insert on public.sitios;
create policy sitios_staff_insert on public.sitios for insert to authenticated
  with check (public.staff_can_access_barangay(barangay_id));
drop policy if exists sitios_staff_delete on public.sitios;
create policy sitios_staff_delete on public.sitios for delete to authenticated
  using (public.staff_can_access_barangay(barangay_id));

grant select on public.sitios to anon, authenticated;
grant insert, delete on public.sitios to authenticated;

-- Rename a sitio. Residents and households that use the old name get the new one too,
-- because they store the name as text.
create or replace function public.rename_sitio(p_sitio_id bigint, p_new_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text; v_brgy integer; v_new text := btrim(coalesce(p_new_name, ''));
begin
  select sitio_name, barangay_id into v_old, v_brgy from public.sitios where sitio_id = p_sitio_id;
  if v_brgy is null then raise exception 'Sitio not found.'; end if;
  if not public.staff_can_access_barangay(v_brgy) then raise exception 'You can only change sitios in your own barangay.'; end if;
  if length(v_new) not between 1 and 80 then raise exception 'Enter a sitio name (up to 80 letters).'; end if;
  update public.sitios set sitio_name = v_new where sitio_id = p_sitio_id;
  update public.residents set sitio = v_new where barangay_id = v_brgy and lower(btrim(sitio)) = lower(btrim(v_old));
  update public.households set sitio = v_new where barangay_id = v_brgy and lower(btrim(sitio)) = lower(btrim(v_old));
end $$;
revoke all on function public.rename_sitio(bigint, text) from public;
grant execute on function public.rename_sitio(bigint, text) to authenticated;

-- Start each list from the sitio names residents already typed.
insert into public.sitios (barangay_id, sitio_name)
select distinct on (barangay_id, lower(btrim(sitio))) barangay_id, btrim(sitio)
from (select barangay_id, sitio from public.residents union all select barangay_id, sitio from public.households) s
where barangay_id is not null and coalesce(btrim(sitio), '') <> ''
on conflict do nothing;

-- DUMMY DATA for testing: Sitio 1, Sitio 2 and Sitio 3 in every barangay.
-- To remove later:  delete from public.sitios where sitio_name in ('Sitio 1', 'Sitio 2', 'Sitio 3');
insert into public.sitios (barangay_id, sitio_name)
select b.barangay_id, n.name from public.barangays b
cross join (values ('Sitio 1'), ('Sitio 2'), ('Sitio 3')) as n(name)
on conflict do nothing;

commit;
