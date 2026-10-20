-- Operational incident declarations; does not link or modify existing SOS/evacuation records.
begin;
create table if not exists public.disaster_events (
  event_id uuid primary key default gen_random_uuid(),
  barangay_id integer not null references public.barangays(barangay_id),
  name text not null check (length(btrim(name)) between 1 and 120),
  hazard_type text not null check (hazard_type in ('flood','fire','earthquake','landslide')),
  location_description text not null check (length(btrim(location_description)) between 1 and 500),
  latitude numeric, longitude numeric,
  started_at timestamptz not null check (isfinite(started_at)),
  notes text not null default '' check (length(notes) <= 2000),
  status text not null default 'active' check (status in ('active','resolved')),
  declared_at timestamptz not null default now(),
  declared_by uuid not null references auth.users(id),
  resolved_at timestamptz, resolved_by uuid references auth.users(id), resolution_reason text,
  check ((latitude is null and longitude is null) or
    (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180)),
  check ((status = 'active' and resolved_at is null and resolved_by is null and resolution_reason is null)
    or (status = 'resolved' and resolved_at is not null and resolved_by is not null and resolution_reason is not null and length(btrim(resolution_reason)) between 1 and 1000))
);
create unique index if not exists disaster_events_active_name
  on public.disaster_events(barangay_id, hazard_type, lower(btrim(name))) where status = 'active';
create table if not exists public.disaster_event_audit (
  audit_id bigint generated always as identity primary key,
  event_id uuid not null references public.disaster_events(event_id),
  action text not null check (action in ('declared','resolved')),
  actor_uid uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  details jsonb not null
);
alter table public.disaster_events enable row level security;
alter table public.disaster_event_audit enable row level security;
revoke all on public.disaster_events, public.disaster_event_audit from public, anon, authenticated;

create or replace function public.assert_disaster_admin(p_barangay integer default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.users u where u.uid = auth.uid()
    and u.account_status = 'active' and (u.role::text = 'super_admin' or
      (u.role::text = 'admin' and u.assigned_barangay_id is not null
        and (p_barangay is null or u.assigned_barangay_id = p_barangay)))) then
    raise exception 'Active administrator access to this barangay is required.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_disaster_admin(integer) from public, anon, authenticated;

create or replace function public.get_disaster_event_register()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; actor_role text; actor_barangay integer;
begin
  perform public.assert_disaster_admin();
  select role::text, assigned_barangay_id into actor_role, actor_barangay from public.users where uid = auth.uid();
  if (select count(*) from public.disaster_events where actor_role = 'super_admin' or barangay_id = actor_barangay) > 2000 then
    raise exception 'Event register exceeds 2,000 records. Add server pagination before loading this register.';
  end if;
  select jsonb_build_object(
    'barangays', (select coalesce(jsonb_agg(jsonb_build_object('barangay_id',s.barangay_id,'barangay_name',s.barangay_name) order by s.barangay_name),'[]'::jsonb)
      from public.barangays s where actor_role = 'super_admin' or s.barangay_id = actor_barangay),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.declared_at desc, e.event_id),'[]'::jsonb)
      from public.disaster_events e where actor_role = 'super_admin' or e.barangay_id = actor_barangay)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_disaster_event_register() from public, anon;
grant execute on function public.get_disaster_event_register() to authenticated;

create or replace function public.declare_disaster_event(
  p_barangay integer, p_name text, p_hazard text, p_location text,
  p_started_at timestamptz, p_notes text, p_lat numeric default null, p_long numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_event public.disaster_events;
begin
  perform public.assert_disaster_admin(p_barangay);
  if p_barangay is null then raise exception 'Select a barangay.'; end if;
  if p_started_at is null or not isfinite(p_started_at) or p_started_at > clock_timestamp() then
    raise exception 'Onset time must be valid and cannot be in the future.';
  end if;
  insert into public.disaster_events(barangay_id,name,hazard_type,location_description,started_at,notes,latitude,longitude,declared_by)
    values(p_barangay,btrim(p_name),p_hazard,btrim(p_location),p_started_at,coalesce(btrim(p_notes),''),p_lat,p_long,auth.uid())
    returning * into new_event;
  insert into public.disaster_event_audit(event_id,action,actor_uid,details)
    values(new_event.event_id,'declared',auth.uid(),to_jsonb(new_event));
  return new_event.event_id;
exception when unique_violation then raise exception 'An active event with this name and hazard already exists in this barangay.';
end;
$$;
revoke all on function public.declare_disaster_event(integer,text,text,text,timestamptz,text,numeric,numeric) from public, anon;
grant execute on function public.declare_disaster_event(integer,text,text,text,timestamptz,text,numeric,numeric) to authenticated;

create or replace function public.resolve_disaster_event(p_event_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_event public.disaster_events;
begin
  perform public.assert_disaster_admin();
  select * into old_event from public.disaster_events where event_id = p_event_id for update;
  if not found then raise exception 'Event was not found.'; end if;
  perform public.assert_disaster_admin(old_event.barangay_id);
  if old_event.status <> 'active' then raise exception 'Event is already resolved. Refresh the register.'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Enter a resolution reason of 1–1,000 characters.'; end if;
  update public.disaster_events set status = 'resolved', resolved_at = clock_timestamp(),
    resolved_by = auth.uid(), resolution_reason = btrim(p_reason) where event_id = p_event_id;
  insert into public.disaster_event_audit(event_id,action,actor_uid,details)
    values(p_event_id,'resolved',auth.uid(),jsonb_build_object('previous',to_jsonb(old_event),'reason',btrim(p_reason)));
end;
$$;
revoke all on function public.resolve_disaster_event(uuid,text) from public, anon;
grant execute on function public.resolve_disaster_event(uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
