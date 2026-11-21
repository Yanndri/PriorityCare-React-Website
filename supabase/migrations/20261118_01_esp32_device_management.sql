-- ESP32 device management + offline report sync (design: "PriorityCare ESP32 Offline SOS", Stages 3-5).
--
-- The ESP32 hotspot collects SOS reports on its own WiFi, keeps them in flash, and forwards them
-- here with gateway_sync() when the hall router has internet. gateway_sync() is idempotent by
-- report_id: a resend after a lost reply returns the earlier result and never creates a second SOS.
-- gateway_heartbeat() records device health every minute and hands back queued commands.
-- Admins manage devices of their own barangay, Super Admins all devices, through the staff RPCs.
-- Existing sos_alerts / dispatch flow is unchanged: a hotspot report becomes a normal sos_alerts row.
-- Safe to run more than once.

-- ---------- Device table (exists from 20261117_01; extended) ----------
create table if not exists public.sos_gateways (
  gateway_id text primary key, name text not null, key_hash text not null,
  active boolean not null default true, last_seen_at timestamptz,
  created_at timestamptz not null default now());

alter table public.sos_gateways
  add column if not exists barangay_id integer references public.barangays (barangay_id),
  add column if not exists paired_by uuid,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists last_sync_at timestamptz,
  add column if not exists sta_ip text,
  add column if not exists wifi_ssid text,
  add column if not exists wifi_rssi integer,
  add column if not exists firmware_version text,
  add column if not exists uptime_s bigint,
  add column if not exists boot_count integer,
  add column if not exists free_heap integer,
  add column if not exists storage_used_pct integer,
  add column if not exists pending_count integer,
  add column if not exists clients_connected integer;

alter table public.sos_gateways enable row level security;
revoke all on public.sos_gateways from anon, authenticated;   -- holds key hashes; read through list_gateways()

drop trigger if exists live_signal on public.sos_gateways;
create trigger live_signal after insert or update or delete on public.sos_gateways
  for each statement execute function public.bump_live_signal('devices');

-- ---------- Reports received by a device ----------
create table if not exists public.hotspot_reports (
  report_id          text primary key check (report_id ~ '^[A-Za-z0-9_-]{3,64}$'),
  gateway_id         text not null references public.sos_gateways (gateway_id) on delete cascade,
  barangay_id        integer,                     -- the device's barangay when synced (for admin scope)
  contact_no         text not null,
  alert_type         text not null,
  note               text not null default '',
  phone_time         timestamptz,                 -- the resident phone's clock when sent
  device_received_at timestamptz,                 -- the ESP32's clock, when it had internet time
  device_uptime_s    bigint,
  synced_at          timestamptz not null default now(),
  result             text not null check (result in ('created', 'already_active', 'not_registered', 'rejected')),
  reason             text,
  resident_uid       uuid,
  alert_id           uuid
);
create index if not exists hotspot_reports_gateway_idx on public.hotspot_reports (gateway_id, synced_at desc);
alter table public.hotspot_reports enable row level security;
revoke all on public.hotspot_reports from anon, authenticated;   -- read through list_hotspot_reports()

-- ---------- Commands queued from the dashboard ----------
create table if not exists public.gateway_commands (
  command_id   bigint generated always as identity primary key,
  gateway_id   text not null references public.sos_gateways (gateway_id) on delete cascade,
  command      text not null check (command in ('resync', 'reboot')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  acked_at     timestamptz,
  result       text
);
create index if not exists gateway_commands_open_idx on public.gateway_commands (gateway_id) where acked_at is null;
alter table public.gateway_commands enable row level security;
revoke all on public.gateway_commands from anon, authenticated;

-- ---------- Helpers ----------
create or replace function public.gateway_auth(p_gateway_id text, p_key text)
returns public.sos_gateways
language plpgsql security definer set search_path to '' as $function$
declare g public.sos_gateways;
begin
  select * into g from public.sos_gateways where gateway_id = p_gateway_id;
  if not found or g.key_hash <> encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex') then
    raise exception 'BAD_GATEWAY: unknown device or wrong secret.' using errcode = '28000';
  end if;
  if not g.active then
    raise exception 'SUSPENDED: this device is disconnected in the dashboard.' using errcode = '42501';
  end if;
  return g;
end;
$function$;
revoke all on function public.gateway_auth(text, text) from public, anon, authenticated;

create or replace function public.safe_int(p text)
returns bigint language sql immutable set search_path to '' as $function$
  select case when p ~ '^-?\d{1,15}$' then p::bigint end
$function$;

-- Epoch milliseconds or seconds -> timestamptz, only if plausible (2024 .. now + 1 day)
create or replace function public.safe_epoch(p text)
returns timestamptz language sql stable set search_path to '' as $function$
  select case
    when p !~ '^\d{9,13}$' then null
    else (select t from (select to_timestamp(case when length(p) = 13 then p::numeric / 1000 else p::numeric end) as t) x
           where t between '2024-01-01'::timestamptz and now() + interval '1 day')
  end
$function$;

-- ---------- Device RPCs (called by the ESP32 with its device secret) ----------
create or replace function public.gateway_heartbeat(p_gateway_id text, p_key text, p_status jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare g public.sos_gateways; v_cmds jsonb;
begin
  g := public.gateway_auth(p_gateway_id, p_key);
  update public.sos_gateways set
    last_seen_at      = now(),
    last_heartbeat_at = now(),
    sta_ip            = left(p_status->>'sta_ip', 45),
    wifi_ssid         = left(p_status->>'wifi_ssid', 64),
    wifi_rssi         = public.safe_int(p_status->>'wifi_rssi'),
    firmware_version  = left(p_status->>'fw', 32),
    uptime_s          = public.safe_int(p_status->>'uptime_s'),
    boot_count        = public.safe_int(p_status->>'boot'),
    free_heap         = public.safe_int(p_status->>'free_heap'),
    storage_used_pct  = public.safe_int(p_status->>'storage_pct'),
    pending_count     = public.safe_int(p_status->>'pending'),
    clients_connected = public.safe_int(p_status->>'clients')
  where gateway_id = g.gateway_id;

  with open_cmds as (
    update public.gateway_commands set delivered_at = coalesce(delivered_at, now())
     where gateway_id = g.gateway_id and acked_at is null
    returning command_id, command)
  select coalesce(jsonb_agg(jsonb_build_object('id', command_id, 'command', command) order by command_id), '[]')
    into v_cmds from open_cmds;

  return jsonb_build_object('ok', true, 'server_time', extract(epoch from now())::bigint, 'commands', v_cmds);
end;
$function$;

create or replace function public.gateway_ack_command(p_gateway_id text, p_key text, p_command_id bigint, p_result text default 'done')
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare g public.sos_gateways;
begin
  g := public.gateway_auth(p_gateway_id, p_key);
  update public.gateway_commands set acked_at = now(), result = left(coalesce(p_result, 'done'), 200)
   where command_id = p_command_id and gateway_id = g.gateway_id and acked_at is null;
  return jsonb_build_object('ok', true);
end;
$function$;

-- Batch of up to 20 reports: [{id, contact, type, note, phone_ms, received_s, uptime_s}, ...]
-- Returns [{id, result, alert_id}], one entry per input. 'retry' entries were not stored.
create or replace function public.gateway_sync(p_gateway_id text, p_key text, p_reports jsonb)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare
  g public.sos_gateways; rep jsonb; out jsonb := '[]'; ex public.hotspot_reports;
  v_id text; v_digits text; v_contact text; v_type text; v_note text; r public.residents;
  v_household uuid; v_alert uuid; v_result text; v_reason text;
begin
  g := public.gateway_auth(p_gateway_id, p_key);
  if jsonb_typeof(p_reports) <> 'array' then raise exception 'p_reports must be a JSON array'; end if;
  if jsonb_array_length(p_reports) > 20 then raise exception 'At most 20 reports per sync.'; end if;

  for rep in select * from jsonb_array_elements(p_reports) loop
    v_id := rep->>'id';
    begin
      if v_id is null or v_id !~ '^[A-Za-z0-9_-]{3,64}$' then
        out := out || jsonb_build_object('id', v_id, 'result', 'rejected', 'reason', 'bad id');
        continue;
      end if;

      -- Idempotency: the same report id always gets the same answer.
      select * into ex from public.hotspot_reports where report_id = v_id;
      if found then
        out := out || jsonb_build_object('id', v_id, 'result', ex.result, 'alert_id', ex.alert_id);
        continue;
      end if;

      v_digits := regexp_replace(coalesce(rep->>'contact', ''), '\D', '', 'g');
      v_contact := case when v_digits ~ '^63\d{10}$' then '0' || substr(v_digits, 3)
                        when v_digits ~ '^9\d{9}$' then '0' || v_digits else v_digits end;
      v_type := upper(coalesce(rep->>'type', ''));
      if v_type not in ('FLOOD', 'FIRE', 'MEDICAL', 'TRAPPED', 'OTHER') then v_type := 'OTHER'; end if;
      v_note := left(btrim(coalesce(rep->>'note', '')), 200);
      v_alert := null; v_reason := null; r := null;

      if v_contact !~ '^09\d{9}$' then
        v_result := 'rejected'; v_reason := 'not a mobile number';
      else
        select res.* into r from public.residents res join public.users u on u.uid = res.uid
         where u.contact_no = v_contact and u.account_status = 'active' limit 1;
        if r.uid is null then
          v_result := 'not_registered';
        else
          select alert_id into v_alert from public.sos_alerts where resident_uid = r.uid and status = 'active' limit 1;
          if v_alert is not null then
            v_result := 'already_active';
          else
            v_household := public.resident_household_id(r.uid);
            insert into public.sos_alerts (resident_uid, household_id, barangay_id, home_barangay_id, alert_type, alert_level,
                                           latitude, longitude, headcount, note, status)
            values (r.uid, v_household, r.barangay_id, r.barangay_id, v_type, public.household_alert_level(r.uid),
                    r.gps_lat, r.gps_long,
                    1 + (select count(*) from public.household_members m where m.household_id = v_household),
                    left('Via ESP32 hotspot ' || g.name || ' (report ' || v_id || ')'
                         || case when v_note <> '' then ': ' || v_note else '' end, 500),
                    'active')
            returning alert_id into v_alert;
            v_result := 'created';
          end if;
        end if;
      end if;

      insert into public.hotspot_reports (report_id, gateway_id, barangay_id, contact_no, alert_type, note,
                                          phone_time, device_received_at, device_uptime_s, result, reason,
                                          resident_uid, alert_id)
      values (v_id, g.gateway_id, coalesce(g.barangay_id, r.barangay_id), v_contact, v_type, v_note,
              public.safe_epoch(rep->>'phone_ms'), public.safe_epoch(rep->>'received_s'),
              public.safe_int(rep->>'uptime_s'), v_result, v_reason, r.uid, v_alert);
      out := out || jsonb_build_object('id', v_id, 'result', v_result, 'alert_id', v_alert);
    exception when unique_violation then
      -- Same id arrived twice at the same moment: report the stored answer.
      select * into ex from public.hotspot_reports where report_id = v_id;
      out := out || jsonb_build_object('id', v_id, 'result', coalesce(ex.result, 'retry'), 'alert_id', ex.alert_id);
    when others then
      out := out || jsonb_build_object('id', v_id, 'result', 'retry', 'reason', left(sqlerrm, 120));
    end;
  end loop;

  update public.sos_gateways set last_sync_at = now(), last_seen_at = now() where gateway_id = g.gateway_id;
  return jsonb_build_object('ok', true, 'results', out);
end;
$function$;

revoke all on function public.gateway_heartbeat(text, text, jsonb) from public;
revoke all on function public.gateway_ack_command(text, text, bigint, text) from public;
revoke all on function public.gateway_sync(text, text, jsonb) from public;
grant execute on function public.gateway_heartbeat(text, text, jsonb) to anon, authenticated;
grant execute on function public.gateway_ack_command(text, text, bigint, text) to anon, authenticated;
grant execute on function public.gateway_sync(text, text, jsonb) to anon, authenticated;

-- ---------- Staff RPCs (Admin: own barangay; Super Admin: all) ----------
create or replace function public.gateway_barangay_guard(p_gateway_id text)
returns public.sos_gateways
language plpgsql security definer set search_path to '' as $function$
declare g public.sos_gateways;
begin
  select * into g from public.sos_gateways where gateway_id = p_gateway_id;
  if not found then raise exception 'Device not found.'; end if;
  if g.barangay_id is null then
    if not public.is_active_super_admin() then
      raise exception 'Only a Super Admin can manage a device with no barangay.' using errcode = '42501';
    end if;
  else
    perform public.assert_disaster_admin(g.barangay_id);
  end if;
  return g;
end;
$function$;
revoke all on function public.gateway_barangay_guard(text) from public, anon, authenticated;

create or replace function public.list_gateways()
returns table (gateway_id text, name text, barangay_id integer, barangay_name text, active boolean,
               created_at timestamptz, last_heartbeat_at timestamptz, last_sync_at timestamptz,
               sta_ip text, wifi_ssid text, wifi_rssi integer, firmware_version text, uptime_s bigint,
               boot_count integer, free_heap integer, storage_used_pct integer, pending_count integer,
               clients_connected integer, open_commands integer, reports_total integer)
language plpgsql stable security definer set search_path to '' as $function$
declare v_role text; v_brgy integer;
begin
  select u.role::text, u.assigned_barangay_id into v_role, v_brgy from public.users u
   where u.uid = auth.uid() and u.account_status = 'active';
  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'Staff access required.' using errcode = '42501';
  end if;
  return query
  select g.gateway_id, g.name, g.barangay_id, b.barangay_name::text, g.active, g.created_at,
         g.last_heartbeat_at, g.last_sync_at, g.sta_ip, g.wifi_ssid, g.wifi_rssi, g.firmware_version,
         g.uptime_s, g.boot_count, g.free_heap, g.storage_used_pct, g.pending_count, g.clients_connected,
         (select count(*)::integer from public.gateway_commands c where c.gateway_id = g.gateway_id and c.acked_at is null),
         (select count(*)::integer from public.hotspot_reports h where h.gateway_id = g.gateway_id)
    from public.sos_gateways g
    left join public.barangays b on b.barangay_id = g.barangay_id
   where v_role = 'super_admin' or g.barangay_id = v_brgy
   order by g.created_at;
end;
$function$;

create or replace function public.list_hotspot_reports(p_gateway_id text, p_limit integer default 50)
returns table (report_id text, contact_no text, alert_type text, note text, phone_time timestamptz,
               device_received_at timestamptz, synced_at timestamptz, result text, reason text, alert_id uuid)
language plpgsql stable security definer set search_path to '' as $function$
begin
  perform public.gateway_barangay_guard(p_gateway_id);
  return query
  select h.report_id, h.contact_no, h.alert_type, h.note, h.phone_time, h.device_received_at,
         h.synced_at, h.result, h.reason, h.alert_id
    from public.hotspot_reports h
   where h.gateway_id = p_gateway_id
   order by h.synced_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;

-- "Connect ESP32": registers a device and returns its id + a one-time secret (only the hash is kept).
create or replace function public.pair_gateway(p_name text, p_barangay_id integer)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_id text; v_secret text;
begin
  if p_barangay_id is null then raise exception 'Choose the barangay this device serves.'; end if;
  perform public.assert_disaster_admin(p_barangay_id);
  if coalesce(btrim(p_name), '') = '' then raise exception 'Give the device a name, e.g. the place it is installed.'; end if;
  loop
    v_id := 'GW-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
    exit when not exists (select 1 from public.sos_gateways where gateway_id = v_id);
  end loop;
  v_secret := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.sos_gateways (gateway_id, name, key_hash, active, barangay_id, paired_by)
  values (v_id, left(btrim(p_name), 80), encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'), true, p_barangay_id, auth.uid());
  return jsonb_build_object('gateway_id', v_id, 'secret', v_secret);
end;
$function$;

-- "Disconnect ESP32" (false) / reconnect (true)
create or replace function public.set_gateway_active(p_gateway_id text, p_active boolean)
returns void
language plpgsql security definer set search_path to '' as $function$
begin
  perform public.gateway_barangay_guard(p_gateway_id);
  update public.sos_gateways set active = coalesce(p_active, false) where gateway_id = p_gateway_id;
end;
$function$;

-- New secret; the old one stops working at once. Returned once.
create or replace function public.rotate_gateway_secret(p_gateway_id text)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_secret text;
begin
  perform public.gateway_barangay_guard(p_gateway_id);
  v_secret := encode(extensions.gen_random_bytes(16), 'hex');
  update public.sos_gateways set key_hash = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex')
   where gateway_id = p_gateway_id;
  return jsonb_build_object('gateway_id', p_gateway_id, 'secret', v_secret);
end;
$function$;

-- Super Admin: move a device to a barangay (e.g. the pilot device GW-01 that has none)
create or replace function public.assign_gateway_barangay(p_gateway_id text, p_barangay_id integer)
returns void
language plpgsql security definer set search_path to '' as $function$
begin
  if not public.is_active_super_admin() then
    raise exception 'Super Admin access required.' using errcode = '42501';
  end if;
  update public.sos_gateways set barangay_id = p_barangay_id where gateway_id = p_gateway_id;
  if not found then raise exception 'Device not found.'; end if;
end;
$function$;

create or replace function public.queue_gateway_command(p_gateway_id text, p_command text)
returns bigint
language plpgsql security definer set search_path to '' as $function$
declare v_id bigint;
begin
  perform public.gateway_barangay_guard(p_gateway_id);
  if p_command not in ('resync', 'reboot') then raise exception 'Unknown command.'; end if;
  insert into public.gateway_commands (gateway_id, command, created_by)
  values (p_gateway_id, p_command, auth.uid()) returning command_id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.list_gateways() from public, anon;
revoke all on function public.list_hotspot_reports(text, integer) from public, anon;
revoke all on function public.pair_gateway(text, integer) from public, anon;
revoke all on function public.set_gateway_active(text, boolean) from public, anon;
revoke all on function public.rotate_gateway_secret(text) from public, anon;
revoke all on function public.assign_gateway_barangay(text, integer) from public, anon;
revoke all on function public.queue_gateway_command(text, text) from public, anon;
grant execute on function public.list_gateways() to authenticated;
grant execute on function public.list_hotspot_reports(text, integer) to authenticated;
grant execute on function public.pair_gateway(text, integer) to authenticated;
grant execute on function public.set_gateway_active(text, boolean) to authenticated;
grant execute on function public.rotate_gateway_secret(text) to authenticated;
grant execute on function public.assign_gateway_barangay(text, integer) to authenticated;
grant execute on function public.queue_gateway_command(text, text) to authenticated;
