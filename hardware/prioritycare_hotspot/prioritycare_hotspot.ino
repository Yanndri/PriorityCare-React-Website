/*
  PriorityCare SOS Hotspot (one ESP32, no extra parts needed)
  Board : ESP32 Dev Module. No extra libraries: WiFi, WebServer, DNSServer,
          HTTPClient and WiFiClientSecure come with the ESP32 board package.

  Put it at the purok or barangay hall. It always broadcasts an open WiFi
  called "PriorityCare SOS". A resident with no load or data connects to it
  and a page pops up by itself: they type their registered mobile number,
  pick the emergency and press SEND SOS.

  The ESP32 forwards the SOS to the PriorityCare dashboard through its own
  internet (barangay WiFi or a phone hotspot set below). If that internet is
  down it keeps the SOS and sends it as soon as the internet is back.
  The resident's page shows "Waiting for internet", then "Sent to rescuers".
  The SOS appears on the dashboard at the household's registered home pin.

  Staff page: connect to "PriorityCare SOS" and open http://192.168.4.1/list
  to see every SOS this hotspot received, even with no internet.

  LED (on-board, GPIO2): solid = internet WiFi connected, slow blink = no
  internet WiFi, fast blink = an SOS is waiting to be sent.
  Optional buzzer on GPIO27 (+) and GND (-): beeps when a new SOS comes in.
*/
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ---- Change these ----
const char* WIFI_SSID    = "Priority_Care_001";                  // internet for the hotspot (2.4 GHz)
const char* WIFI_PASS    = "";
const char* GATEWAY_ID   = "GW-01";                           // sos_gateways.gateway_id
const char* GATEWAY_KEY  = "pc-gw01-UxD0ggEg8DZnvrlbIHqtrD68";    // the secret you registered in sos_gateways
const char* HOTSPOT_NAME = "PriorityCare SOS";                // the WiFi name residents see
const char* PLACE_NAME   = "Barangay Hall";                   // shown on the page

const char* SUPABASE_RPC = "https://urioaayowijvhwbuxxaj.supabase.co/rest/v1/rpc/hotspot_sos";
const char* SUPABASE_KEY = "sb_publishable_4U89GUwsifai0yHblicJ-w_iQifQfkS"; // public key, same as the app

const int PIN_LED = 2, PIN_BUZZER = 27;
const unsigned long RETRY_MS = 10000;

// ---- SOS queue ----
enum SosState { WAITING, SENT, NOT_REGISTERED, FAILED };
struct Sos { bool used; int id; String contact; String type; String note; SosState state; unsigned long at; unsigned long nextTry; };
const int QUEUE_SIZE = 30;
Sos q[QUEUE_SIZE];
int nextId = 1;

WebServer server(80);
DNSServer dns;
unsigned long ledTimer = 0, wifiTimer = 0, connectStart = 0;
bool connecting = false;
bool ledOn = false;

void beep(int ms) { digitalWrite(PIN_BUZZER, HIGH); delay(ms); digitalWrite(PIN_BUZZER, LOW); }

String htmlEscape(const String& s) {
  String o; for (char c : s) { if (c == '<') o += "&lt;"; else if (c == '>') o += "&gt;"; else if (c == '&') o += "&amp;"; else if (c == '"') o += "&quot;"; else o += c; } return o;
}
String jsonEscape(const String& s) {
  String o; for (char c : s) { if (c == '"' || c == '\\') { o += '\\'; o += c; } else if ((unsigned char)c < 0x20) o += ' '; else o += c; } return o;
}
// Same rule as the app: +639..., 639..., 9... -> 09...; returns "" if not a PH mobile number
String normalizeContact(const String& in) {
  String d; for (char c : in) if (isdigit(c)) d += c;
  if (d.length() == 12 && d.startsWith("639")) d = "0" + d.substring(2);
  else if (d.length() == 10 && d.startsWith("9")) d = "0" + d;
  if (d.length() == 11 && d.startsWith("09")) return d;
  return "";
}
Sos* findById(int id) { for (int i = 0; i < QUEUE_SIZE; i++) if (q[i].used && q[i].id == id) return &q[i]; return nullptr; }

// ---------- Pages ----------
const char* STYLE =
  "<meta name=viewport content='width=device-width,initial-scale=1'><meta charset=utf-8>"
  "<style>body{font-family:sans-serif;margin:0;padding:16px;background:#F8FAFC;color:#0F172A}"
  "h1{color:#DC2626;margin:0 0 4px}p{margin:6px 0}.card{background:#fff;border:1px solid #CBD5E1;border-radius:12px;padding:16px;margin-top:12px}"
  "input,textarea{width:100%;box-sizing:border-box;font-size:18px;padding:12px;border:1px solid #CBD5E1;border-radius:8px;margin:6px 0 12px}"
  ".types label{display:block;font-size:18px;padding:10px;border:1px solid #CBD5E1;border-radius:8px;margin:6px 0}"
  "button{width:100%;font-size:22px;font-weight:700;padding:16px;background:#DC2626;color:#fff;border:0;border-radius:12px}"
  ".err{color:#DC2626;font-weight:700}.ok{color:#15803D;font-weight:700}.wait{color:#B45309;font-weight:700}"
  "table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #E2E8F0;padding:6px;text-align:left}</style>";

void sendForm(const String& error, const String& contact) {
  String h = String("<!doctype html><html><head><title>PriorityCare SOS</title>") + STYLE + "</head><body>";
  h += "<h1>PriorityCare SOS</h1><p>No load needed. This sends an SOS to the barangay rescue team.</p>";
  h += "<p>Hotspot: <b>" + htmlEscape(PLACE_NAME) + "</b></p>";
  h += "<form class=card method=POST action=/sos>";
  h += "<b>Your registered mobile number</b><input name=contact type=tel inputmode=numeric placeholder='09171234567' value='" + htmlEscape(contact) + "'>";
  if (error.length()) h += "<p class=err>" + htmlEscape(error) + "</p>";
  h += "<b>Emergency</b><div class=types>"
       "<label><input type=radio name=type value=FLOOD style='width:auto' checked> Flood</label>"
       "<label><input type=radio name=type value=TRAPPED style='width:auto'> Trapped</label>"
       "<label><input type=radio name=type value=MEDICAL style='width:auto'> Medical</label>"
       "<label><input type=radio name=type value=FIRE style='width:auto'> Fire</label>"
       "<label><input type=radio name=type value=OTHER style='width:auto'> Other</label></div>";
  h += "<b>Details (optional)</b><textarea name=note rows=3 maxlength=200 placeholder='e.g. 3 people on the roof, 1 senior'></textarea>";
  h += "<button type=submit>SEND SOS</button></form>";
  h += "<p style='font-size:13px;color:#64748B;margin-top:12px'>Not registered? Ask the barangay staff here for help.</p></body></html>";
  server.send(200, "text/html", h);
}

void handleRoot() { Serial.println("Phone opened the SOS page"); sendForm("", ""); }

void handleSos() {
  String contact = normalizeContact(server.arg("contact"));
  if (contact == "") return sendForm("Enter an 11-digit mobile number starting with 09, e.g. 09171234567.", server.arg("contact"));
  String type = server.arg("type"); if (type == "") type = "OTHER";
  String note = server.arg("note"); note.trim(); if (note.length() > 200) note = note.substring(0, 200);

  // Same number pressed twice: show the same SOS instead of queueing a duplicate
  for (int i = 0; i < QUEUE_SIZE; i++) {
    if (q[i].used && q[i].contact == contact && (q[i].state == WAITING || q[i].state == SENT)) {
      server.sendHeader("Location", "/status?id=" + String(q[i].id), true); server.send(302, "text/plain", ""); return;
    }
  }
  int slot = -1;
  for (int i = 0; i < QUEUE_SIZE && slot < 0; i++) if (!q[i].used) slot = i;
  if (slot < 0) {   // full: reuse the oldest finished one
    unsigned long oldest = 0xFFFFFFFFUL;
    for (int i = 0; i < QUEUE_SIZE; i++) if (q[i].state != WAITING && q[i].at < oldest) { oldest = q[i].at; slot = i; }
  }
  if (slot < 0) return sendForm("The hotspot is busy. Please tell the barangay staff here.", contact);
  q[slot] = { true, nextId++, contact, type, note, WAITING, millis(), 0 };
  Serial.printf("New SOS #%d from %s (%s)\n", q[slot].id, contact.c_str(), type.c_str());
  beep(200); delay(100); beep(200); delay(100); beep(200);
  server.sendHeader("Location", "/status?id=" + String(q[slot].id), true);
  server.send(302, "text/plain", "");
}

void handleStatus() {
  Sos* s = findById(server.arg("id").toInt());
  if (!s) { server.sendHeader("Location", "/", true); server.send(302, "text/plain", ""); return; }
  String h = String("<!doctype html><html><head><title>SOS status</title>") + STYLE;
  if (s->state == WAITING) h += "<meta http-equiv=refresh content=5>";
  h += "</head><body><h1>SOS #" + String(s->id) + "</h1><div class=card>";
  h += "<p>Number: <b>" + s->contact + "</b></p><p>Emergency: <b>" + s->type + "</b></p>";
  if (s->state == WAITING)
    h += "<p class=wait>Received by the hotspot. Waiting for internet to reach the rescue team...</p><p>It will send by itself. You can close this page.</p>";
  else if (s->state == SENT)
    h += "<p class=ok>Sent to the rescue team. Help is being arranged.</p><p>Stay where it is safe. Rescuers will go to your registered home location.</p>";
  else if (s->state == NOT_REGISTERED)
    h += "<p class=err>This number is not registered in PriorityCare.</p><p>Please tell the barangay staff here, or try the number you registered with.</p><p><a href=/>Try again</a></p>";
  else
    h += "<p class=err>The hotspot could not send this SOS.</p><p>Please tell the barangay staff here.</p>";
  h += "</div></body></html>";
  server.send(200, "text/html", h);
}

void handleList() {   // for barangay staff at the hotspot
  String h = String("<!doctype html><html><head><title>SOS list</title>") + STYLE + "<meta http-equiv=refresh content=10></head><body>";
  h += "<h1>SOS received here</h1><p>Internet: <b>" + String(WiFi.status() == WL_CONNECTED ? "connected" : "OFFLINE") + "</b></p>";
  h += "<table><tr><th>#</th><th>Number</th><th>Type</th><th>Min ago</th><th>Status</th><th>Details</th></tr>";
  for (int i = 0; i < QUEUE_SIZE; i++) {
    if (!q[i].used) continue;
    const char* st = q[i].state == WAITING ? "waiting" : q[i].state == SENT ? "sent" : q[i].state == NOT_REGISTERED ? "not registered" : "failed";
    h += "<tr><td>" + String(q[i].id) + "</td><td>" + q[i].contact + "</td><td>" + q[i].type + "</td><td>" +
         String((millis() - q[i].at) / 60000) + "</td><td>" + st + "</td><td>" + htmlEscape(q[i].note) + "</td></tr>";
  }
  h += "</table></body></html>";
  server.send(200, "text/html", h);
}

void redirectToRoot() {   // captive portal: any other address opens the SOS page
  Serial.println("Phone asked for " + server.hostHeader() + server.uri() + " -> SOS page");
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

bool haveInternetWifi() { return strlen(WIFI_SSID) > 0 && strcmp(WIFI_SSID, "YOUR_WIFI_NAME") != 0; }

// Try the internet WiFi for at most 15 s, then rest 45 s. While the ESP32 searches
// for a WiFi it changes channel, which drops phones from the SOS hotspot, so it
// must not search non-stop.
void manageInternetWifi() {
  if (!haveInternetWifi() || WiFi.status() == WL_CONNECTED) { connecting = false; return; }
  if (connecting && millis() - connectStart > 15000) {
    Serial.println("Internet WiFi not found, retrying in 45 s");
    WiFi.disconnect(false);          // stops searching; the SOS hotspot stays on
    connecting = false;
    wifiTimer = millis();
  } else if (!connecting && millis() - wifiTimer > 45000) {
    Serial.printf("Connecting to internet WiFi \"%s\"...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    connecting = true;
    connectStart = millis();
  }
}

// ---------- Sending to Supabase ----------
// 1 = sent, 0 = retry later, 2 = number not registered, -1 = rejected for another reason
int postSos(const Sos& s) {
  if (WiFi.status() != WL_CONNECTED) return 0;
  WiFiClientSecure client;
  client.setInsecure();   // pilot only: skips certificate check
  HTTPClient http;
  if (!http.begin(client, SUPABASE_RPC)) return 0;
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  String body = String("{\"p_gateway_id\":\"") + jsonEscape(GATEWAY_ID) +
                "\",\"p_gateway_key\":\"" + jsonEscape(GATEWAY_KEY) +
                "\",\"p_contact\":\"" + jsonEscape(s.contact) +
                "\",\"p_type\":\"" + jsonEscape(s.type) +
                "\",\"p_note\":\"" + jsonEscape(s.note) + "\"}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("SOS #%d -> Supabase %d: %s\n", s.id, code, resp.c_str());
  if (code == 200) return 1;
  if (resp.indexOf("NOT_REGISTERED") >= 0) return 2;
  if (code >= 400 && code < 500) return -1;
  return 0;
}

void sendQueue() {
  for (int i = 0; i < QUEUE_SIZE; i++) {
    Sos& s = q[i];
    if (!s.used || s.state != WAITING || millis() < s.nextTry) continue;
    int r = postSos(s);
    if (r == 1) { s.state = SENT; beep(100); }
    else if (r == 2) s.state = NOT_REGISTERED;
    else if (r == -1) { s.state = FAILED; Serial.println("Rejected: check GATEWAY_ID / GATEWAY_KEY"); }
    else s.nextTry = millis() + RETRY_MS;
    return;   // one at a time so the web page stays responsive
  }
}

bool anyWaiting() { for (int i = 0; i < QUEUE_SIZE; i++) if (q[i].used && q[i].state == WAITING) return true; return false; }

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.setAutoReconnect(false);                 // we reconnect ourselves, gently (manageInternetWifi)
  bool apOk = WiFi.softAP(HOTSPOT_NAME);        // open, so anyone can join
  Serial.printf("SOS hotspot %s, IP %s\n", apOk ? "started" : "FAILED", WiFi.softAPIP().toString().c_str());
  wifiTimer = millis() - 45000;                 // first internet attempt right away

  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", WiFi.softAPIP());          // every address -> this ESP32
  server.on("/", handleRoot);
  server.on("/sos", HTTP_POST, handleSos);
  server.on("/status", handleStatus);
  server.on("/list", handleList);
  server.on("/generate_204", redirectToRoot);         // Android
  server.on("/gen_204", redirectToRoot);              // Android
  server.on("/hotspot-detect.html", handleRoot);      // iPhone
  server.on("/connecttest.txt", redirectToRoot);      // Windows
  server.onNotFound(redirectToRoot);
  server.begin();
  Serial.printf("PriorityCare SOS hotspot \"%s\" is on. Page: http://192.168.4.1  Staff: /list\n", HOTSPOT_NAME);
}

void loop() {
  dns.processNextRequest();
  server.handleClient();

  bool online = WiFi.status() == WL_CONNECTED;
  static bool wasOnline = false;
  if (online != wasOnline) { wasOnline = online; Serial.println(online ? "Internet WiFi connected" : "Internet WiFi lost"); }
  manageInternetWifi();

  sendQueue();

  if (anyWaiting()) {
    if (millis() - ledTimer > 120) { ledTimer = millis(); ledOn = !ledOn; digitalWrite(PIN_LED, ledOn); }
  } else if (online) {
    digitalWrite(PIN_LED, HIGH);
  } else if (millis() - ledTimer > 800) {
    ledTimer = millis(); ledOn = !ledOn; digitalWrite(PIN_LED, ledOn);
  }
}
