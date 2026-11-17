-- Offline SOS buttons (ESP32 + LoRa).
-- A household button sends SOS over LoRa radio (no internet needed) to a gateway
-- ESP32 at the barangay hall. The gateway forwards it here with device_sos(),
-- which creates the same sos_alerts row that raise_sos() creates from the app,
-- so it shows on the dashboard and enters the normal rescue workflow.
-- Safe to run more than once.

create table if not exists public.sos_gateways (
  gateway_id   text primary key,
  name         text not null,
  key_hash     text not null,          -- sha256 hex of the gateway's secret key
  active       boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.sos_devices (
  node_id         text primary key,    -- printed on the button, e.g. NODE-001
  resident_uid    uuid not null,       -- head of household the button belongs to
  label           text,
  active          boolean not null default true,
  last_seen_at    timestamptz,
  last_gateway_id text,
  last_rssi       integer,
  created_at      timestamptz not null default now()
);

alter table public.sos_gateways enable row level security;
alter table public.sos_devices  enable row level security;
revoke all on public.sos_gateways, public.sos_devices from anon, authenticated;
grant select on public.sos_devices to authenticated;
drop policy if exists sos_devices_staff_read on public.sos_devices;
create policy sos_devices_staff_read on public.sos_devices
  for select to authenticated using (public.is_active_staff());
-- sos_gateways stays unreadable to clients: it holds key hashes.

create or replace function public.device_sos(
  p_gateway_id text, p_gateway_key text, p_node_id text,
  p_type text default 'OTHER', p_rssi integer default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  g public.sos_gateways; d public.sos_devices; r public.residents;
  v_household uuid; v_alert uuid; v_new boolean := false; v_type text;
begin
  select * into g from public.sos_gateways where gateway_id = p_gateway_id and active;
  if not found or g.key_hash <> encode(sha256(convert_to(coalesce(p_gateway_key, ''), 'UTF8')), 'hex') then
    raise exception 'Unknown gateway or wrong gateway key.';
  end if;
  update public.sos_gateways set last_seen_at = now() where gateway_id = g.gateway_id;

  select * into d from public.sos_devices where node_id = p_node_id and active;
  if not found then raise exception 'SOS button % is not registered.', p_node_id; end if;
  update public.sos_devices
     set last_seen_at = now(), last_gateway_id = g.gateway_id, last_rssi = p_rssi
   where node_id = d.node_id;

  select * into r from public.residents where uid = d.resident_uid;
  if not found then raise exception 'The household for button % no longer exists.', d.node_id; end if;
  if not exists (select 1 from public.users where uid = r.uid and account_status = 'active') then
    raise exception 'The account for button % is not active.', d.node_id;
  end if;

  v_type := upper(coalesce(p_type, ''));
  if v_type not in ('FLOOD', 'FIRE', 'MEDICAL', 'TRAPPED', 'OTHER') then v_type := 'OTHER'; end if;

  -- Same rule as raise_sos: one live SOS per resident; pressing again returns it.
  select alert_id into v_alert from public.sos_alerts
   where resident_uid = r.uid and status = 'active' limit 1;
  if v_alert is null then
    v_household := public.resident_household_id(r.uid);
    insert into public.sos_alerts (resident_uid, household_id, barangay_id, home_barangay_id, alert_type, alert_level,
                                   latitude, longitude, headcount, note, status)
    values (r.uid, v_household, r.barangay_id, r.barangay_id, v_type, public.household_alert_level(r.uid),
            r.gps_lat, r.gps_long,
            1 + (select count(*) from public.household_members m where m.household_id = v_household),
            left('Offline SOS button ' || d.node_id || coalesce(' (' || d.label || ')', '') || ' via ' || g.name, 500),
            'active')
    returning alert_id into v_alert;
    v_new := true;
  end if;

  return jsonb_build_object('ok', true, 'alert_id', v_alert, 'new', v_new, 'node_id', d.node_id);
end;
$function$;

revoke all on function public.device_sos(text, text, text, text, integer) from public;
grant execute on function public.device_sos(text, text, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- SOS hotspot: one ESP32 at a purok / barangay hall broadcasts an open WiFi
-- "PriorityCare SOS". A resident with no load connects, a page pops up, they
-- type their registered mobile number and pick the emergency. The ESP32
-- forwards it here (now, or later when its internet is back).
-- The SOS is placed at the resident's registered home pin.
-- ---------------------------------------------------------------------------
create or replace function public.hotspot_sos(
  p_gateway_id text, p_gateway_key text, p_contact text,
  p_type text default 'OTHER', p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  g public.sos_gateways; r public.residents; v_digits text; v_contact text;
  v_household uuid; v_alert uuid; v_new boolean := false; v_type text;
begin
  select * into g from public.sos_gateways where gateway_id = p_gateway_id and active;
  if not found or g.key_hash <> encode(sha256(convert_to(coalesce(p_gateway_key, ''), 'UTF8')), 'hex') then
    raise exception 'BAD_GATEWAY: unknown hotspot or wrong key.';
  end if;
  update public.sos_gateways set last_seen_at = now() where gateway_id = g.gateway_id;

  -- Same normalisation as the app: +639..., 639..., 9... -> 09...
  v_digits := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
  v_contact := case
    when v_digits ~ '^63\d{10}$' then '0' || substr(v_digits, 3)
    when v_digits ~ '^9\d{9}$' then '0' || v_digits
    else v_digits end;

  select res.* into r
    from public.residents res
    join public.users u on u.uid = res.uid
   where u.contact_no = v_contact and u.account_status = 'active'
   limit 1;
  if not found then
    raise exception 'NOT_REGISTERED: % is not a registered PriorityCare resident.', v_contact;
  end if;

  v_type := upper(coalesce(p_type, ''));
  if v_type not in ('FLOOD', 'FIRE', 'MEDICAL', 'TRAPPED', 'OTHER') then v_type := 'OTHER'; end if;

  -- One live SOS per resident, same rule as the app.
  select alert_id into v_alert from public.sos_alerts
   where resident_uid = r.uid and status = 'active' limit 1;
  if v_alert is null then
    v_household := public.resident_household_id(r.uid);
    insert into public.sos_alerts (resident_uid, household_id, barangay_id, home_barangay_id, alert_type, alert_level,
                                   latitude, longitude, headcount, note, status)
    values (r.uid, v_household, r.barangay_id, r.barangay_id, v_type, public.household_alert_level(r.uid),
            r.gps_lat, r.gps_long,
            1 + (select count(*) from public.household_members m where m.household_id = v_household),
            left('Sent from SOS hotspot ' || g.name
                 || coalesce(nullif(': ' || btrim(coalesce(p_note, '')), ': '), ''), 500),
            'active')
    returning alert_id into v_alert;
    v_new := true;
  end if;

  return jsonb_build_object('ok', true, 'alert_id', v_alert, 'new', v_new);
end;
$function$;

revoke all on function public.hotspot_sos(text, text, text, text, text) from public;
grant execute on function public.hotspot_sos(text, text, text, text, text) to anon, authenticated;

-- Register the hotspot. Change the secret here AND in GATEWAY_KEY in the sketch
-- before running (keep them identical). Re-running updates the secret.
insert into public.sos_gateways (gateway_id, name, key_hash)
values ('GW-01', 'Barangay Hall', encode(sha256(convert_to('pc-gw01-UxD0ggEg8DZnvrlbIHqtrD68', 'UTF8')), 'hex'))
on conflict (gateway_id) do update set name = excluded.name, key_hash = excluded.key_hash, active = true;
