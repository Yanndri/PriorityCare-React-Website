-- "Do you see it too?": the prompt and the confirmation now reach 10 km from the pin (was 1 km).

create or replace function public.get_nearby_hazards(p_lat numeric, p_lng numeric)
 returns table(hazard_id uuid, hazard_type text, description text, latitude numeric, longitude numeric, distance_m integer, status text, created_at timestamp with time zone, confirmed_by_me boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select h.hazard_id, h.hazard_type::text, h.description, h.latitude, h.longitude,
         round(public.distance_m(p_lat, p_lng, h.latitude, h.longitude))::integer,
         h.status::text, h.created_at,
         exists (select 1 from public.hazard_confirmations x where x.hazard_id = h.hazard_id and x.uid = auth.uid())
  from public.hazard_reports h
  where p_lat is not null and p_lng is not null
    and exists (select 1 from public.users where uid = auth.uid() and account_status = 'active')
    and h.status in ('unverified', 'under_review', 'confirmed')
    and h.reported_by is distinct from auth.uid()
    and h.created_at > now() - interval '6 hours'
    and public.distance_m(p_lat, p_lng, h.latitude, h.longitude) <= 10000
  order by 6
$function$;

create or replace function public.confirm_hazard(p_hazard_id uuid, p_lat numeric, p_lng numeric)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare h public.hazard_reports;
begin
  if not exists (select 1 from public.users where uid = auth.uid() and account_status = 'active') then
    raise exception 'Sign in first.';
  end if;
  select * into h from public.hazard_reports where hazard_id = p_hazard_id;
  if not found or h.status not in ('unverified', 'under_review', 'confirmed') then
    raise exception 'This hazard report is closed.';
  end if;
  if h.reported_by = auth.uid() then raise exception 'You reported this hazard yourself.'; end if;
  if p_lat is null or p_lng is null or public.distance_m(p_lat, p_lng, h.latitude, h.longitude) > 10000 then
    raise exception 'You need to be within 10 km of the hazard to confirm it.';
  end if;
  insert into public.hazard_confirmations (hazard_id, uid) values (p_hazard_id, auth.uid())
  on conflict do nothing;
end $function$;
