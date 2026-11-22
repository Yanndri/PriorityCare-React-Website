-- Forgot PIN with a one-time code "sent by SMS" (prototype: the SMS is simulated).
-- The pin-reset Edge Function calls these two functions with the service role:
--   request_pin_reset_code(contact)       -> a new 6-digit code, valid 10 minutes
--   verify_pin_reset_code(contact, code)  -> the resident's uid when the code is right
-- Rules, same as a real SMS code: one code per number at a time (a new one replaces the old),
-- 60 s before a resend, at most 5 codes per number per hour, 5 wrong tries per code,
-- single use. Only a bcrypt hash of the code is stored.
-- Safe to run more than once. Run it in the Supabase SQL Editor.

create table if not exists public.pin_reset_codes (
  contact_no   text primary key,            -- normalized, e.g. 09171234567
  uid          uuid references auth.users(id) on delete cascade, -- null: not a registered resident
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  used_at      timestamptz,
  sent_at      timestamptz not null default now(),
  window_start timestamptz not null default now(),
  sends_in_window integer not null default 1
);
alter table public.pin_reset_codes enable row level security;
-- No policies: only the functions below and the service role use this table.
revoke all on public.pin_reset_codes from anon, authenticated;
grant select, insert, update, delete on public.pin_reset_codes to service_role;

create or replace function public.request_pin_reset_code(p_contact text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_contact text := public.normalize_contact_no(p_contact);
  v_row public.pin_reset_codes;
  v_uid uuid;
  v_raw bytea := extensions.gen_random_bytes(4);
  v_code text;
  v_wait integer;
begin
  if v_contact is null or v_contact !~ '^09\d{9}$' then
    raise exception 'Enter your mobile number like 09171234567.' using errcode = '22023';
  end if;

  select * into v_row from public.pin_reset_codes where contact_no = v_contact for update;
  if found then
    v_wait := ceil(extract(epoch from (v_row.sent_at + interval '60 seconds' - now())))::integer;
    if v_wait > 0 then
      return jsonb_build_object('ok', false, 'wait_s', v_wait,
        'message', format('Please wait %s seconds before asking for another code.', v_wait));
    end if;
    if v_row.window_start > now() - interval '1 hour' and v_row.sends_in_window >= 5 then
      return jsonb_build_object('ok', false, 'wait_s',
        ceil(extract(epoch from (v_row.window_start + interval '1 hour' - now())))::integer,
        'message', 'Too many codes for this number. Try again in an hour, or ask your barangay admin to reset your PIN.');
    end if;
  end if;

  select a.id into v_uid
    from auth.users a
    join public.users u on u.uid = a.id and u.role = 'resident' and u.account_status = 'active'
   where a.email = public.resident_login_email(v_contact);

  -- 6 digits, 000000 to 999999.
  v_code := lpad(((get_byte(v_raw, 0)::bigint << 24 | get_byte(v_raw, 1) << 16 | get_byte(v_raw, 2) << 8 | get_byte(v_raw, 3)) % 1000000)::text, 6, '0');

  insert into public.pin_reset_codes as c (contact_no, uid, code_hash, expires_at, attempts, used_at, sent_at, window_start, sends_in_window)
  values (v_contact, v_uid, extensions.crypt(v_code, extensions.gen_salt('bf', 6)), now() + interval '10 minutes', 0, null, now(), now(), 1)
  on conflict (contact_no) do update set
    uid = excluded.uid, code_hash = excluded.code_hash, expires_at = excluded.expires_at,
    attempts = 0, used_at = null, sent_at = now(),
    window_start = case when c.window_start > now() - interval '1 hour' then c.window_start else now() end,
    sends_in_window = case when c.window_start > now() - interval '1 hour' then c.sends_in_window + 1 else 1 end;

  -- The same answer whether or not the number is registered, so the screen never reveals it.
  -- (A real SMS gateway would simply not deliver to an unregistered number.)
  return jsonb_build_object('ok', true, 'code', v_code, 'registered', v_uid is not null,
    'masked', substr(v_contact, 1, 4) || '***' || substr(v_contact, 8, 4), 'expires_in_s', 600);
end $$;

-- Never raises on a wrong code, so the try counter is always saved.
create or replace function public.verify_pin_reset_code(p_contact text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_contact text := public.normalize_contact_no(p_contact);
  v_code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_row public.pin_reset_codes;
begin
  select * into v_row from public.pin_reset_codes where contact_no = v_contact for update;
  if not found or v_row.used_at is not null then
    return jsonb_build_object('ok', false, 'message', 'Ask for a new code first.');
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'This code has expired. Ask for a new one.');
  end if;
  if v_row.attempts >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Too many wrong tries. Ask for a new code.');
  end if;
  if length(v_code) <> 6 or extensions.crypt(v_code, v_row.code_hash) <> v_row.code_hash or v_row.uid is null then
    update public.pin_reset_codes set attempts = attempts + 1 where contact_no = v_contact;
    return jsonb_build_object('ok', false, 'message',
      case when v_row.attempts + 1 >= 5 then 'Wrong code. That was the last try; ask for a new code.'
           else format('Wrong code. %s tries left.', 5 - (v_row.attempts + 1)) end);
  end if;
  update public.pin_reset_codes set used_at = now() where contact_no = v_contact;
  return jsonb_build_object('ok', true, 'uid', v_row.uid);
end $$;

revoke all on function public.request_pin_reset_code(text) from public, anon, authenticated;
revoke all on function public.verify_pin_reset_code(text, text) from public, anon, authenticated;
grant execute on function public.request_pin_reset_code(text) to service_role;
grant execute on function public.verify_pin_reset_code(text, text) to service_role;

notify pgrst, 'reload schema';
