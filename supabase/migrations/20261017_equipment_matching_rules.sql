-- Module 5.4: match extraction equipment to medical / vulnerability profiles.
-- Requires 20261014_disaster_events.sql (assert_disaster_admin). Adds an editable rules table,
-- default rules, and two RPCs. Rules are suggestions for dispatchers; trained personnel confirm.
begin;

create table if not exists public.equipment_rules (
  rule_id integer generated always as identity primary key,
  match_kind text not null check (match_kind in ('mobility','disability','pregnancy','age_under','age_at_least','needs_keyword')),
  -- mobility: ambulatory|semi_ambulatory|non_ambulatory · disability: a disability_types name ·
  -- pregnancy: 'true' · age_*: whole years · needs_keyword: word/phrase found in vulnerability needs (case-insensitive)
  match_value text not null check (length(btrim(match_value)) between 1 and 60),
  equipment text not null check (length(btrim(equipment)) between 1 and 60),
  note text not null default '' check (length(note) <= 300),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (match_kind not in ('age_under','age_at_least') or match_value ~ '^[0-9]{1,3}$'),
  check (match_kind <> 'pregnancy' or match_value = 'true'),
  check (match_kind <> 'mobility' or match_value in ('ambulatory','semi_ambulatory','non_ambulatory'))
);
create unique index if not exists equipment_rules_unique
  on public.equipment_rules(match_kind, lower(btrim(match_value)), lower(btrim(equipment)));

insert into public.equipment_rules(match_kind, match_value, equipment, note) values
  ('mobility', 'non_ambulatory', 'Stretcher / spineboard', 'Cannot walk; carry out lying down'),
  ('mobility', 'semi_ambulatory', 'Wheelchair', 'Can stand or walk short distances with help'),
  ('disability', 'Physical', 'Wheelchair', 'Physical disability; confirm on scene'),
  ('disability', 'Visual', 'Guide rope / sighted escort', 'Low or no vision'),
  ('disability', 'Hearing', 'Written cards / light signals', 'Cannot rely on spoken or siren instructions'),
  ('disability', 'Intellectual', 'Familiar companion / calm escort', 'May need simple, patient instructions'),
  ('disability', 'Psychosocial', 'Familiar companion / calm escort', 'Reduce stress during extraction'),
  ('pregnancy', 'true', 'First aid kit', 'Pregnancy recorded'),
  ('age_under', '5', 'Infant kit', 'Infant or toddler'),
  ('age_at_least', '80', 'Wheelchair', 'Very elderly; long walks may not be safe'),
  ('needs_keyword', 'oxygen', 'Oxygen', 'Needs oxygen support'),
  ('needs_keyword', 'bedridden', 'Stretcher / spineboard', 'Bedridden mentioned in needs'),
  ('needs_keyword', 'wheelchair', 'Wheelchair', 'Uses a wheelchair'),
  ('needs_keyword', 'dialysis', 'Medical transport', 'Needs regular dialysis'),
  ('needs_keyword', 'insulin', 'Medicine cooler', 'Insulin must stay cool'),
  ('needs_keyword', 'seizure', 'First aid kit', 'Seizure history'),
  ('needs_keyword', 'cane', 'Walking aid', 'Uses a cane')
on conflict do nothing;

create table if not exists public.equipment_rule_audit (
  audit_id bigint generated always as identity primary key,
  rule_id integer not null references public.equipment_rules(rule_id),
  previous jsonb,
  current jsonb not null,
  actor_uid uuid not null references auth.users(id),
  changed_at timestamptz not null default clock_timestamp()
);

alter table public.equipment_rules enable row level security;
alter table public.equipment_rule_audit enable row level security;
revoke all on public.equipment_rules, public.equipment_rule_audit from public, anon, authenticated;

-- Any active admin can read the rules (Dispatch, resident profiles).
create or replace function public.get_equipment_rules()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_role text;
begin
  perform public.assert_disaster_admin();
  select role::text into actor_role from public.users where uid = auth.uid();
  return jsonb_build_object(
    'can_edit', actor_role = 'super_admin',
    'disability_types', (select coalesce(jsonb_agg(d.disability_name order by d.disability_name), '[]'::jsonb) from public.disability_types d),
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
        'rule_id', r.rule_id, 'match_kind', r.match_kind, 'match_value', r.match_value, 'equipment', r.equipment,
        'note', r.note, 'is_active', r.is_active, 'updated_at', r.updated_at,
        'updated_by_name', (select concat_ws(' ', u.f_name, u.l_name) from public.users u where u.uid = r.updated_by)
      ) order by r.match_kind, r.match_value, r.equipment), '[]'::jsonb) from public.equipment_rules r)
  );
end;
$$;
revoke all on function public.get_equipment_rules() from public, anon;
grant execute on function public.get_equipment_rules() to authenticated;

-- Create (p_rule_id null) or edit a rule. Rules are shared by every barangay, so only super admins change them.
-- Turn a rule off with p_active = false; rules are never removed, so history stays readable.
create or replace function public.save_equipment_rule(p_rule_id integer, p_kind text, p_value text, p_equipment text, p_note text, p_active boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_role text; old_rule public.equipment_rules; new_rule public.equipment_rules; v text := btrim(coalesce(p_value, ''));
begin
  perform public.assert_disaster_admin();
  select role::text into actor_role from public.users where uid = auth.uid();
  if actor_role <> 'super_admin' then
    raise exception 'Only a super admin can change equipment rules (they apply to every barangay).' using errcode = '42501';
  end if;
  if p_kind = 'mobility' then v := lower(replace(v, '-', '_')); end if;
  if p_kind = 'pregnancy' then v := 'true'; end if;
  if p_kind = 'disability' and not exists (select 1 from public.disability_types d where d.disability_name = v) then
    raise exception 'Unknown disability type "%".', v;
  end if;
  if p_kind = 'needs_keyword' then v := lower(v); end if;
  if p_rule_id is null then
    insert into public.equipment_rules(match_kind, match_value, equipment, note, is_active, updated_by)
      values (p_kind, v, btrim(p_equipment), btrim(coalesce(p_note, '')), coalesce(p_active, true), auth.uid())
      returning * into new_rule;
  else
    select * into old_rule from public.equipment_rules where rule_id = p_rule_id for update;
    if not found then raise exception 'Rule was not found.'; end if;
    update public.equipment_rules set match_kind = p_kind, match_value = v, equipment = btrim(p_equipment),
      note = btrim(coalesce(p_note, '')), is_active = coalesce(p_active, true), updated_at = clock_timestamp(), updated_by = auth.uid()
      where rule_id = p_rule_id returning * into new_rule;
  end if;
  insert into public.equipment_rule_audit(rule_id, previous, current, actor_uid)
    values (new_rule.rule_id, case when old_rule.rule_id is null then null else to_jsonb(old_rule) end, to_jsonb(new_rule), auth.uid());
  return new_rule.rule_id;
exception
  when unique_violation then raise exception 'An identical rule already exists.';
  when check_violation then raise exception 'Check the rule: age needs a whole number, mobility must be ambulatory, semi_ambulatory or non_ambulatory, and text fields have length limits.';
end;
$$;
revoke all on function public.save_equipment_rule(integer, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_equipment_rule(integer, text, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
