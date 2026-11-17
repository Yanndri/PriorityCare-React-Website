# PriorityCare offline SOS buttons (ESP32 + LoRa)

Household button --LoRa radio, no internet--> Gateway at the barangay hall --WiFi--> Supabase `device_sos()` --> admin dashboard (same `sos_alerts` row the app creates).

## Parts (per device)
- ESP32 dev board (ESP32-WROOM DevKit)
- SX1276/SX1278 LoRa module, e.g. Ai-Thinker Ra-02 (433 MHz), with antenna
- Push button (node), LED (on-board is fine), optional active buzzer
- Power: USB power bank or 18650 + charger board

## Wiring (node and gateway are the same)
| ESP32 | Ra-02 |
|---|---|
| 3.3V | VCC (never 5V) |
| GND | GND |
| GPIO18 | SCK |
| GPIO19 | MISO |
| GPIO23 | MOSI |
| GPIO5 | NSS |
| GPIO14 | RST |
| GPIO26 | DIO0 |

Node button: GPIO4 to GND. Buzzer: GPIO27. Attach the antenna before powering the radio.

## Arduino IDE setup
1. File > Preferences > Additional boards URL: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. Tools > Board > Boards Manager: install **esp32 by Espressif**.
3. Sketch > Include Library > Manage Libraries: install **LoRa by Sandeep Mistry**.
4. Board: **ESP32 Dev Module**. Upload speed 115200 if uploads fail. Hold BOOT while "Connecting..." if needed.

## 1. Database (once)
Paste `supabase/migrations/20261117_01_offline_sos_buttons.sql` into the Supabase SQL Editor and run it.

Register the gateway (pick your own long secret, and put the same text in `GATEWAY_KEY` in the gateway sketch):
```sql
insert into public.sos_gateways (gateway_id, name, key_hash)
values ('GW-01', 'Barangay Hall', encode(sha256(convert_to('CHANGE-ME-long-random-secret', 'UTF8')), 'hex'));
```
Register each button to a household head by their mobile number:
```sql
insert into public.sos_devices (node_id, resident_uid, label)
select 'NODE-001', uid, 'Santos household' from public.users where contact_no = '09171234567';
```

## 2. Gateway
Open `prioritycare_gateway/prioritycare_gateway.ino`, set `WIFI_SSID`, `WIFI_PASS`, `GATEWAY_KEY`, upload, and open Serial Monitor at 115200. You should see "listening" and the LED goes solid when WiFi connects.

## 3. Node
Open `prioritycare_node/prioritycare_node.ino`, set `NODE_ID` (must match the row above) and optionally `SOS_TYPE`, upload.

## Test
Hold the node button 2 seconds. Node LED blinks fast, then stays solid when the gateway answers. Gateway Serial shows `SOS from NODE-001` then `Supabase 200`. The SOS appears on the dashboard at the household's registered home pin.

Unplug the gateway's WiFi and press again: the gateway still beeps and ACKs, keeps the SOS queued, and sends it as soon as WiFi is back.

## Only one ESP32? Use `prioritycare_single/`
`prioritycare_single/prioritycare_single.ino` is the button and gateway in one board, with no LoRa module. Hold the button 2 s and it sends the SOS over WiFi (barangay WiFi or a phone hotspot), so the resident's phone needs no load or data. If the internet is down it beeps, keeps the SOS and retries every 10 s. Do the same database step and the two SQL inserts above, then set `WIFI_SSID`, `WIFI_PASS`, `GATEWAY_KEY` and `NODE_ID` in the sketch and upload. It only needs the "esp32" board package, no extra library.

After an SOS it also turns into a rescue beacon: it broadcasts an open WiFi network named "SOS PriorityCare NODE-001" that any rescuer phone sees in its WiFi list (about 30 to 50 m, no internet needed; stronger bars = closer), serves a page at http://192.168.4.1 with the household info you set in `HOUSEHOLD` and `PEOPLE_INFO`, and beeps every 5 seconds. Hold the button 10 s to silence it.

Limit: without LoRa it still needs WiFi within about 30 to 50 m. For true no-internet coverage across the barangay, add a second ESP32 and two Ra-02 modules and use the node and gateway sketches.

## Notes and limits
- Both sketches must use the same frequency, sync word, spreading factor and `NETWORK_KEY`.
- Range at SF10 is roughly 1 to 5 km in town, more with the gateway antenna high up.
- The location sent is the household's registered home pin, not live GPS.
- One live SOS per household, same as the app: pressing again while one is active doesn't create a duplicate.
- `setInsecure()` skips HTTPS certificate checks. Fine for the pilot; pin the certificate for real deployment.
- The radio packets are not encrypted; `NETWORK_KEY` only filters out other LoRa traffic. Only registered `node_id`s are accepted by the database.
- While the gateway is sending to Supabase (up to 10 s) it can miss a packet, but nodes resend every 3 s for about 2 minutes, so it is picked up.
