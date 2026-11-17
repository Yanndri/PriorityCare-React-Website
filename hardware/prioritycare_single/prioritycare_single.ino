/*
  PriorityCare SOS button, single ESP32 version (no LoRa module needed)
  Board : ESP32 Dev Module. No extra libraries: WiFi, WebServer, HTTPClient and
          WiFiClientSecure come with the ESP32 board package.

  Hold the button 2 seconds to raise an SOS. Then the ESP32 does three things:
   1. Sends the SOS to Supabase (device_sos) over WiFi, e.g. barangay WiFi or a
      phone hotspot. If there is no WiFi/internet it retries every 10 seconds
      until it goes through, and it then appears on the admin dashboard.
   2. Becomes a rescue beacon: it broadcasts its own WiFi network named
      "SOS PriorityCare NODE-001". Any rescuer phone sees it in the normal WiFi
      list, no internet or app needed. Stronger bars = closer. Connecting to it
      and opening http://192.168.4.1 shows who is there and how long ago SOS was pressed.
   3. Beeps every 5 seconds so rescuers can find the exact spot when nearby.
  The beacon and beeps continue after the SOS is delivered, until someone
  holds the button for 10 seconds (that only silences the device; the SOS on
  the dashboard is closed by the admin/app as usual) or power is removed.

  LED: slow blink = no WiFi, off = ready, fast blink = SOS waiting to send,
       solid on = SOS delivered to the dashboard (beacon still on).

  Wiring: button GPIO4 to GND, active buzzer GPIO27 (+) and GND (-).
          LED is the on-board LED (GPIO2). A louder buzzer helps a lot.
*/
#include <WiFi.h>
#include <WebServer.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ---- Change these ----
const char* WIFI_SSID   = "YOUR_WIFI_NAME";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char* GATEWAY_ID  = "GW-01";                          // sos_gateways.gateway_id
const char* GATEWAY_KEY = "CHANGE-ME-long-random-secret";   // secret you hashed into sos_gateways
const char* NODE_ID     = "NODE-001";                       // sos_devices.node_id (the household)
const char* SOS_TYPE    = "OTHER";                          // FLOOD, FIRE, MEDICAL, TRAPPED or OTHER
const char* HOUSEHOLD   = "Santos household, Sitio Example"; // shown on the beacon page
const char* PEOPLE_INFO = "4 people, 1 senior, 1 child";     // shown on the beacon page

const char* SUPABASE_RPC = "https://urioaayowijvhwbuxxaj.supabase.co/rest/v1/rpc/device_sos";
const char* SUPABASE_KEY = "sb_publishable_4U89GUwsifai0yHblicJ-w_iQifQfkS"; // public key, same as the app

const int PIN_BUTTON = 4, PIN_LED = 2, PIN_BUZZER = 27;
const unsigned long HOLD_MS = 2000, CANCEL_MS = 10000, RETRY_MS = 10000, BEEP_EVERY_MS = 5000;

bool sosActive = false;   // beacon + beeps on
bool pending = false;     // not yet delivered to Supabase
bool delivered = false;
bool fired = false;       // one action per press
unsigned long pressStart = 0, nextTry = 0, ledTimer = 0, wifiTimer = 0, lastBeep = 0, sosAt = 0;
bool ledOn = false;

WebServer server(80);

void beep(int ms) { digitalWrite(PIN_BUZZER, HIGH); delay(ms); digitalWrite(PIN_BUZZER, LOW); }

// ---------- Beacon ----------
void handlePage() {
  unsigned long mins = (millis() - sosAt) / 60000;
  String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                "<body style='font-family:sans-serif;padding:16px'>"
                "<h1 style='color:#DC2626'>SOS - PriorityCare</h1>";
  html += "<p><b>Button:</b> " + String(NODE_ID) + "</p>";
  html += "<p><b>Household:</b> " + String(HOUSEHOLD) + "</p>";
  html += "<p><b>People:</b> " + String(PEOPLE_INFO) + "</p>";
  html += "<p><b>Emergency:</b> " + String(SOS_TYPE) + "</p>";
  html += "<p><b>Pressed:</b> " + String(mins) + " min ago</p>";
  html += "<p><b>Sent to dashboard:</b> " + String(delivered ? "yes" : "not yet (no internet)") + "</p>";
  html += "<p>Follow the beeping. This device is inside or right next to the household.</p></body>";
  server.send(200, "text/html", html);
}

void startBeacon() {
  WiFi.mode(WIFI_AP_STA);                       // keep trying the internet WiFi too
  String name = String("SOS PriorityCare ") + NODE_ID;
  WiFi.softAP(name.c_str());                    // open network so any rescuer can join
  server.on("/", handlePage);
  server.onNotFound(handlePage);
  server.begin();
  Serial.println("Beacon on: " + name + " (http://192.168.4.1)");
}

void stopBeacon() {
  server.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  Serial.println("Beacon off");
}

// ---------- Supabase ----------
// 1 = delivered, 0 = retry later, -1 = rejected (fix setup, don't retry)
int postSos() {
  if (WiFi.status() != WL_CONNECTED) return 0;
  WiFiClientSecure client;
  client.setInsecure();   // pilot only: skips certificate check
  HTTPClient http;
  if (!http.begin(client, SUPABASE_RPC)) return 0;
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  String body = String("{\"p_gateway_id\":\"") + GATEWAY_ID +
                "\",\"p_gateway_key\":\"" + GATEWAY_KEY +
                "\",\"p_node_id\":\"" + NODE_ID +
                "\",\"p_type\":\"" + SOS_TYPE +
                "\",\"p_rssi\":" + String(WiFi.RSSI()) + "}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("Supabase %d: %s\n", code, resp.c_str());
  if (code == 200) return 1;
  if (code >= 400 && code < 500) return -1;
  return 0;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("PriorityCare SOS button %s ready\n", NODE_ID);
}

void loop() {
  if (sosActive) server.handleClient();

  bool wifiUp = WiFi.status() == WL_CONNECTED;
  if (!wifiUp && millis() - wifiTimer > 15000) {
    wifiTimer = millis();
    Serial.println("Connecting WiFi...");
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }

  // Button: hold 2 s = SOS, hold 10 s while SOS is on = silence the device
  if (digitalRead(PIN_BUTTON) == LOW) {
    if (pressStart == 0) pressStart = millis();
    unsigned long held = millis() - pressStart;
    if (!fired && !sosActive && held >= HOLD_MS) {
      fired = true;
      Serial.println("SOS button held");
      for (int i = 0; i < 3; i++) { beep(200); delay(100); }
      sosActive = true; pending = true; delivered = false; nextTry = 0; sosAt = millis(); lastBeep = millis();
      startBeacon();
    } else if (!fired && sosActive && held >= CANCEL_MS) {
      fired = true;
      beep(800);
      sosActive = false; pending = false; delivered = false;
      stopBeacon();
      digitalWrite(PIN_LED, LOW);
    }
  } else {
    pressStart = 0;
    fired = false;
  }

  if (pending && millis() >= nextTry) {
    int r = postSos();
    if (r == 1) { pending = false; delivered = true; Serial.println("SOS delivered"); beep(150); delay(100); beep(150); }
    else if (r == -1) { pending = false; Serial.println("SOS rejected: check the gateway key and that NODE_ID is registered"); }
    else nextTry = millis() + RETRY_MS;
  }

  // Locator beeps so rescuers can find the spot
  if (sosActive && millis() - lastBeep >= BEEP_EVERY_MS) {
    lastBeep = millis();
    beep(120); delay(80); beep(120); delay(80); beep(120);
  }

  // LED status
  if (pending) {
    if (millis() - ledTimer > 120) { ledTimer = millis(); ledOn = !ledOn; digitalWrite(PIN_LED, ledOn); }
  } else if (delivered) {
    digitalWrite(PIN_LED, HIGH);
  } else if (!wifiUp) {
    if (millis() - ledTimer > 800) { ledTimer = millis(); ledOn = !ledOn; digitalWrite(PIN_LED, ledOn); }
  } else {
    digitalWrite(PIN_LED, LOW);
  }
}
