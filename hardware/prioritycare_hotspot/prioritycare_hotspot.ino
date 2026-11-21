/*
  PriorityCare SOS Hotspot v2 (one ESP32, no extra parts)
  Board: "ESP32 Dev Module". Libraries: none to install. WiFi, WebServer, DNSServer,
  HTTPClient, WiFiClientSecure, Preferences and LittleFS come with the ESP32 board package.

  What it does
  - Always broadcasts an open WiFi "PriorityCare SOS". A resident with no load connects and a
    page opens by itself: registered mobile number, emergency type, SEND SOS.
  - Every SOS is saved to the ESP32's flash first (it survives power loss and reboots), then the
    resident sees "Received". Each SOS has a unique id, so it is never created twice.
  - The ESP32 also joins the barangay hall router (or a backup WiFi). When that has internet it
    sends the saved SOS to PriorityCare and reports its health every minute. An SOS is marked
    sent only after PriorityCare confirms it. Until then it stays saved and is retried.
  - Staff console (PIN): from the hall router WiFi open http://<ESP32 IP>/staff (the IP is shown
    on the dashboard's ESP32 Devices page and in the Serial Monitor). With no router, join
    "PriorityCare SOS" and open http://192.168.4.1/staff. The console works with no internet.

  First time set-up
  1. Upload this sketch. Open the Serial Monitor (115200). It prints the staff PIN.
  2. In the dashboard, ESP32 Devices > Connect ESP32. It shows a Device ID and a one-time secret.
  3. Join "PriorityCare SOS", open http://192.168.4.1/staff, log in with the PIN, open Settings
     and enter the hall WiFi, the Device ID and the secret. Change the PIN there too.
  Forgot the PIN: hold the BOOT button for 10 seconds while it is running. Settings reset
  (saved SOS reports are kept) and a new PIN is printed in the Serial Monitor.

  LED (GPIO2): solid = internet WiFi connected, slow blink = no internet WiFi,
  fast blink = SOS waiting to be sent. Optional buzzer: GPIO27 (+) and GND (-).
*/
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <time.h>
#include <sys/time.h>

#define FW_VERSION "2.0.0"
const char* HOTSPOT_NAME = "PriorityCare SOS";
const char* SUPABASE_RPC = "https://urioaayowijvhwbuxxaj.supabase.co/rest/v1/rpc/";
const char* SUPABASE_KEY = "sb_publishable_4U89GUwsifai0yHblicJ-w_iQifQfkS"; // public key, same as the app

const int PIN_LED = 2, PIN_BUZZER = 27, PIN_BOOT = 0;
const int MAX_REPORTS = 300;                 // saved in flash; oldest already-sent ones are removed first
const int SYNC_BATCH = 10;
const unsigned long HEARTBEAT_MS = 60000;
const unsigned long SYNC_MIN_MS = 10000, SYNC_MAX_MS = 300000;
const unsigned long SESSION_MS = 2UL * 3600UL * 1000UL;
const unsigned long WIFI_TRY_MS = 15000, WIFI_REST_MS = 45000;

// ---------- Settings (stored in flash, entered on the staff Settings page) ----------
struct Config { String place, ssid1, pass1, ssid2, pass2, gwId, secret, pin; } cfg;
Preferences prefs;
uint32_t bootCount = 0;
uint16_t seqNo = 0;

// ---------- Saved reports ----------
// state: P = waiting to send, C = sent (SOS created), A = sent (resident already had an active SOS),
//        N = number not registered, R = rejected
struct Rec {
  bool used; char id[40]; char view[9]; char contact[12]; char type[8]; char state;
  uint32_t recvEpoch; uint32_t recvUptime; uint32_t boot; uint32_t ord;
};
Rec recs[MAX_REPORTS];

// one-time form tokens: a double tap or a resent form shows the same SOS instead of a new one
struct Token { char t[9]; char rec[40]; unsigned long at; };
Token tokens[24];
struct Hit { uint32_t ip; unsigned long at; };
Hit hits[16];
struct Session { char tok[33]; unsigned long at; };
Session sessions[3];
int badPins = 0; unsigned long lockUntil = 0;

WebServer server(80);
DNSServer dns;

// ---------- Cloud state ----------
unsigned long nextHeartbeat = 0, nextSync = 0, syncDelay = SYNC_MIN_MS;
unsigned long lastHeartbeatOk = 0, lastSyncOk = 0;
bool everHeartbeat = false, everSync = false;
String cloudError = "";
bool forceSync = false;

// ---------- WiFi state ----------
unsigned long wifiTimer = 0, connectStart = 0, ledTimer = 0, bootHeldSince = 0;
bool connecting = false, ledOn = false, wasOnline = false;
int wifiIdx = 0;

// ================= Helpers =================
void beep(int ms) { digitalWrite(PIN_BUZZER, HIGH); delay(ms); digitalWrite(PIN_BUZZER, LOW); }

String htmlEscape(const String& s) {
  String o; o.reserve(s.length() + 8);
  for (char c : s) { if (c == '<') o += "&lt;"; else if (c == '>') o += "&gt;"; else if (c == '&') o += "&amp;"; else if (c == '"') o += "&quot;"; else if (c == '\'') o += "&#39;"; else o += c; }
  return o;
}
String jsonEscape(const String& s) {
  String o; o.reserve(s.length() + 8);
  for (char c : s) { if (c == '"' || c == '\\') { o += '\\'; o += c; } else if ((unsigned char)c < 0x20) o += ' '; else o += c; }
  return o;
}
// Same rule as the app: +639..., 639..., 9... -> 09...; "" if not a PH mobile number
String normalizeContact(const String& in) {
  String d; for (char c : in) if (isdigit((unsigned char)c)) d += c;
  if (d.length() == 12 && d.startsWith("639")) d = "0" + d.substring(2);
  else if (d.length() == 10 && d.startsWith("9")) d = "0" + d;
  if (d.length() == 11 && d.startsWith("09")) return d;
  return "";
}
String maskContact(const char* c) { String s(c); return s.length() == 11 ? s.substring(0, 4) + "***" + s.substring(8) : String("***"); }
String randomHex(int bytes) { String s; char b[3]; for (int i = 0; i < bytes; i++) { snprintf(b, 3, "%02x", (unsigned)(esp_random() & 0xFF)); s += b; } return s; }
bool validId(const String& s, int minLen, int maxLen) {
  if ((int)s.length() < minLen || (int)s.length() > maxLen) return false;
  for (char c : s) if (!(isalnum((unsigned char)c) || c == '-' || c == '_')) return false;
  return true;
}
bool allDigits(const String& s) { if (!s.length()) return false; for (char c : s) if (!isdigit((unsigned char)c)) return false; return true; }
bool clockValid() { return time(nullptr) > 1700000000; }
uint32_t uptimeS() { return millis() / 1000; }
String deviceId() {
  if (cfg.gwId.length()) return cfg.gwId;
  uint8_t m[6]; WiFi.macAddress(m); char b[16]; snprintf(b, sizeof b, "ESP%02X%02X%02X", m[3], m[4], m[5]); return String(b);
}
bool cloudConfigured() { return cfg.gwId.length() && cfg.secret.length(); }
int storagePct() { size_t t = LittleFS.totalBytes(); return t ? (int)(LittleFS.usedBytes() * 100 / t) : 0; }
int pendingCount() { int n = 0; for (int i = 0; i < MAX_REPORTS; i++) if (recs[i].used && recs[i].state == 'P') n++; return n; }
int reportCount() { int n = 0; for (int i = 0; i < MAX_REPORTS; i++) if (recs[i].used) n++; return n; }
bool fromAp() { return server.client().localIP() == WiFi.softAPIP(); }
String agoText(unsigned long ms) {
  unsigned long s = (millis() - ms) / 1000;
  if (s < 90) return String(s) + " s ago";
  if (s < 5400) return String(s / 60) + " min ago";
  return String(s / 3600) + " h ago";
}
// When the report arrived, as an epoch, if the clock was known then or can be worked out now
uint32_t recvEpochOf(const Rec& r) {
  if (r.recvEpoch) return r.recvEpoch;
  if (r.boot == bootCount && clockValid()) return (uint32_t)time(nullptr) - (uptimeS() - r.recvUptime);
  return 0;
}
String recTimeText(const Rec& r) {
  uint32_t e = recvEpochOf(r);
  if (e) { time_t t = e; struct tm tmv; localtime_r(&t, &tmv); char b[24]; strftime(b, sizeof b, "%b %d %I:%M %p", &tmv); return String(b); }
  if (r.boot == bootCount) return String((uptimeS() - r.recvUptime) / 60) + " min ago";
  return "before last restart";
}
const char* stateText(char s) {
  switch (s) { case 'P': return "waiting to send"; case 'C': return "sent"; case 'A': return "sent (already active)";
               case 'N': return "not registered"; default: return "rejected"; }
}

// ================= Settings =================
void loadConfig() {
  prefs.begin("pc", false);
  cfg.place  = prefs.getString("place", "Barangay Hall");
  cfg.ssid1  = prefs.getString("ssid1", "");
  cfg.pass1  = prefs.getString("pass1", "");
  cfg.ssid2  = prefs.getString("ssid2", "");
  cfg.pass2  = prefs.getString("pass2", "");
  cfg.gwId   = prefs.getString("gwid", "");
  cfg.secret = prefs.getString("secret", "");
  cfg.pin    = prefs.getString("pin", "");
  bootCount  = prefs.getUInt("boot", 0) + 1;
  prefs.putUInt("boot", bootCount);
  if (cfg.pin.length() < 6) {
    cfg.pin = String(100000 + (esp_random() % 900000));
    prefs.putString("pin", cfg.pin);
  }
  bool showPin = !prefs.getBool("pinchanged", false);
  prefs.end();
  if (showPin) Serial.printf("\n*** Staff PIN: %s  (change it on the Settings page) ***\n\n", cfg.pin.c_str());
  else Serial.println("Staff PIN is set (hold BOOT 10 s to reset settings if forgotten).");
}

void resetSettings() {
  prefs.begin("pc", false);
  uint32_t b = prefs.getUInt("boot", 0);
  prefs.clear();
  prefs.putUInt("boot", b);       // keep the boot count so report ids stay unique
  prefs.end();
  Serial.println("Settings reset. Saved SOS reports were kept. Restarting...");
  delay(500);
  ESP.restart();
}

// ================= Report storage (LittleFS) =================
String recPath(const char* id) { return String("/r/") + id + ".txt"; }

bool writeRec(const Rec& r, const String& phoneMs, const String& alert, const String& note) {
  File f = LittleFS.open("/r/tmp.txt", "w");
  if (!f) return false;
  size_t n = f.printf("%s\n%s\n%s\n%s\n%c\n%lu\n%lu\n%lu\n%lu\n", r.id, r.view, r.contact, r.type, r.state,
                      (unsigned long)r.recvEpoch, (unsigned long)r.recvUptime, (unsigned long)r.boot, (unsigned long)r.ord);
  n += f.print(phoneMs + "\n" + alert + "\n" + note);
  f.close();
  if (n < 20) { LittleFS.remove("/r/tmp.txt"); return false; }
  String p = recPath(r.id);
  if (!LittleFS.rename("/r/tmp.txt", p)) {          // LittleFS replaces the old file in one step
    LittleFS.remove(p);
    if (!LittleFS.rename("/r/tmp.txt", p)) return false;
  }
  return true;
}

bool readRec(const String& path, Rec& r, String* phoneMs, String* alert, String* note) {
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  String L[9];
  for (int i = 0; i < 9; i++) { if (!f.available()) { f.close(); return false; } L[i] = f.readStringUntil('\n'); }
  String pm = f.readStringUntil('\n'), al = f.readStringUntil('\n'), nt = f.readString();
  f.close();
  if (!L[0].length()) return false;
  memset(&r, 0, sizeof r);
  r.used = true;
  strlcpy(r.id, L[0].c_str(), sizeof r.id); strlcpy(r.view, L[1].c_str(), sizeof r.view);
  strlcpy(r.contact, L[2].c_str(), sizeof r.contact); strlcpy(r.type, L[3].c_str(), sizeof r.type);
  r.state = L[4].length() ? L[4][0] : 'P';
  r.recvEpoch = strtoul(L[5].c_str(), nullptr, 10); r.recvUptime = strtoul(L[6].c_str(), nullptr, 10);
  r.boot = strtoul(L[7].c_str(), nullptr, 10); r.ord = strtoul(L[8].c_str(), nullptr, 10);
  if (phoneMs) *phoneMs = pm;
  if (alert) *alert = al;
  if (note) *note = nt;
  return true;
}

void loadReports() {
  if (!LittleFS.exists("/r")) LittleFS.mkdir("/r");
  LittleFS.remove("/r/tmp.txt");
  File dir = LittleFS.open("/r");
  int n = 0, skipped = 0;
  while (true) {
    File f = dir.openNextFile();
    if (!f) break;
    String path = String(f.path());
    f.close();
    if (!path.endsWith(".txt")) continue;
    Rec r;
    if (!readRec(path, r, nullptr, nullptr, nullptr)) { skipped++; continue; }
    if (n < MAX_REPORTS) recs[n++] = r; else skipped++;
  }
  dir.close();
  Serial.printf("Saved reports loaded: %d (%d waiting to send)%s\n", n, pendingCount(), skipped ? ", some files skipped" : "");
}

int findRec(const char* id) { for (int i = 0; i < MAX_REPORTS; i++) if (recs[i].used && strcmp(recs[i].id, id) == 0) return i; return -1; }

// Oldest already-handled report (never one still waiting to send)
int oldestHandled() {
  int best = -1;
  for (int i = 0; i < MAX_REPORTS; i++) if (recs[i].used && recs[i].state != 'P' && (best < 0 || recs[i].ord < recs[best].ord)) best = i;
  return best;
}
void dropRec(int i) { LittleFS.remove(recPath(recs[i].id)); recs[i].used = false; }

int freeSlot() {
  while (storagePct() > 85) { int o = oldestHandled(); if (o < 0) break; dropRec(o); }
  for (int i = 0; i < MAX_REPORTS; i++) if (!recs[i].used) return i;
  int o = oldestHandled();
  if (o >= 0) { dropRec(o); return o; }
  return -1;
}

// Same number already waiting, or sent within the last 30 minutes of this power-on
int recentByContact(const String& contact) {
  for (int i = 0; i < MAX_REPORTS; i++) {
    Rec& r = recs[i];
    if (!r.used || contact != r.contact) continue;
    if (r.state == 'P') return i;
    if ((r.state == 'C' || r.state == 'A') && r.boot == bootCount && uptimeS() - r.recvUptime < 1800) return i;
  }
  return -1;
}

bool setState(int i, char state, const String& alertId) {
  Rec r; String pm, al, nt;
  if (!readRec(recPath(recs[i].id), r, &pm, &al, &nt)) { pm = ""; nt = ""; }
  recs[i].state = state;
  return writeRec(recs[i], pm, alertId.length() ? alertId : al, nt);
}

// ================= Resident pages (SOS WiFi side) =================
const char* STYLE =
  "<meta name=viewport content='width=device-width,initial-scale=1'><meta charset=utf-8>"
  "<style>body{font-family:sans-serif;margin:0;padding:16px;background:#F8FAFC;color:#0F172A}"
  "h1{color:#DC2626;margin:0 0 4px}h2{margin:16px 0 6px}p{margin:6px 0}.card{background:#fff;border:1px solid #CBD5E1;border-radius:12px;padding:16px;margin-top:12px}"
  "input,textarea,select{width:100%;box-sizing:border-box;font-size:18px;padding:12px;border:1px solid #CBD5E1;border-radius:8px;margin:6px 0 12px}"
  ".types label{display:block;font-size:18px;padding:10px;border:1px solid #CBD5E1;border-radius:8px;margin:6px 0}"
  "button{width:100%;font-size:22px;font-weight:700;padding:16px;background:#DC2626;color:#fff;border:0;border-radius:12px}"
  "button.sec{background:#334155;font-size:16px;padding:12px;margin-top:8px}"
  ".err{color:#DC2626;font-weight:700}.ok{color:#15803D;font-weight:700}.wait{color:#B45309;font-weight:700}.muted{color:#64748B;font-size:13px}"
  "table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #E2E8F0;padding:6px;text-align:left;vertical-align:top}"
  ".grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}a{color:#1D4ED8}</style>";

void noCache() { server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate"); }
void redirect(const String& to) { noCache(); server.sendHeader("Location", to, true); server.send(302, "text/plain", ""); }

String issueToken() {
  int slot = 0;
  for (int i = 1; i < 24; i++) if (tokens[i].at < tokens[slot].at) slot = i;
  String t = randomHex(4);
  strlcpy(tokens[slot].t, t.c_str(), sizeof tokens[slot].t);
  tokens[slot].rec[0] = 0;
  tokens[slot].at = millis() | 1;
  return t;
}
int findToken(const String& t) {
  if (t.length() != 8) return -1;
  for (int i = 0; i < 24; i++) if (tokens[i].at && t == tokens[i].t && millis() - tokens[i].at < 1800000UL) return i;
  return -1;
}
bool rateLimited(uint32_t ip) {
  int n = 0;
  for (int i = 0; i < 16; i++) if (hits[i].at && hits[i].ip == ip && millis() - hits[i].at < 600000UL) n++;
  return n >= 3;
}
void recordHit(uint32_t ip) {
  int slot = 0;
  for (int i = 1; i < 16; i++) if (hits[i].at < hits[slot].at) slot = i;
  hits[slot].ip = ip; hits[slot].at = millis() | 1;
}

void sendForm(const String& error, const String& contact) {
  String h = String("<!doctype html><html><head><title>PriorityCare SOS</title>") + STYLE + "</head><body>";
  h += "<h1>PriorityCare SOS</h1><p>No load needed. This sends an SOS to the barangay rescue team.</p>";
  h += "<p>Hotspot: <b>" + htmlEscape(cfg.place) + "</b></p>";
  h += "<form class=card method=POST action=/sos onsubmit=\"this.pm.value=Date.now();this.b.disabled=true\">";
  h += "<input type=hidden name=t value=" + issueToken() + "><input type=hidden name=pm value=''>";
  h += "<b>Your registered mobile number</b><input name=contact type=tel inputmode=numeric autocomplete=tel placeholder='09171234567' value='" + htmlEscape(contact) + "'>";
  if (error.length()) h += "<p class=err>" + htmlEscape(error) + "</p>";
  h += "<b>Emergency</b><div class=types>"
       "<label><input type=radio name=type value=FLOOD style='width:auto' checked> Flood</label>"
       "<label><input type=radio name=type value=TRAPPED style='width:auto'> Trapped</label>"
       "<label><input type=radio name=type value=MEDICAL style='width:auto'> Medical</label>"
       "<label><input type=radio name=type value=FIRE style='width:auto'> Fire</label>"
       "<label><input type=radio name=type value=OTHER style='width:auto'> Other</label></div>";
  h += "<b>Details (optional)</b><textarea name=note rows=3 maxlength=200 placeholder='e.g. 3 people on the roof, 1 senior'></textarea>";
  h += "<button type=submit name=b>SEND SOS</button></form>";
  h += "<p class=muted style='margin-top:12px'>Not registered? Ask the barangay staff here for help.</p></body></html>";
  noCache();
  server.send(200, "text/html", h);
}

void redirectStatus(int i) { redirect(String("/status?id=") + recs[i].id + "&k=" + recs[i].view); }

void handleRoot() {
  if (!fromAp()) return redirect("/staff");
  sendForm("", "");
}

void handleSos() {
  if (!fromAp()) return redirect("/staff");
  int ti = findToken(server.arg("t"));
  if (ti < 0) return sendForm("This page was old. Please press SEND SOS again.", server.arg("contact"));
  if (tokens[ti].rec[0]) { int ri = findRec(tokens[ti].rec); if (ri >= 0) return redirectStatus(ri); }

  String contact = normalizeContact(server.arg("contact"));
  if (contact == "") return sendForm("Enter an 11-digit mobile number starting with 09, e.g. 09171234567.", server.arg("contact"));

  int ex = recentByContact(contact);
  if (ex >= 0) { strlcpy(tokens[ti].rec, recs[ex].id, sizeof tokens[ti].rec); return redirectStatus(ex); }

  uint32_t ip = (uint32_t)server.client().remoteIP();
  if (rateLimited(ip)) return sendForm("This phone already sent 3 SOS in 10 minutes. Please tell the barangay staff here.", contact);

  String type = server.arg("type");
  if (type != "FLOOD" && type != "TRAPPED" && type != "MEDICAL" && type != "FIRE") type = "OTHER";
  String note = server.arg("note");
  note.replace("\r", ""); note.replace("\n", " "); note.trim();
  if (note.length() > 200) note = note.substring(0, 200);
  String pm = server.arg("pm"); if (!allDigits(pm) || pm.length() != 13) pm = "";

  int slot = freeSlot();
  if (slot < 0) return sendForm("The hotspot storage is full. Please tell the barangay staff here.", contact);

  Rec& r = recs[slot];
  memset(&r, 0, sizeof r);
  seqNo++;
  snprintf(r.id, sizeof r.id, "%s-%04lu-%04u", deviceId().c_str(), (unsigned long)bootCount, (unsigned)seqNo);
  strlcpy(r.view, randomHex(4).c_str(), sizeof r.view);
  strlcpy(r.contact, contact.c_str(), sizeof r.contact);
  strlcpy(r.type, type.c_str(), sizeof r.type);
  r.state = 'P';
  r.recvEpoch = clockValid() ? (uint32_t)time(nullptr) : 0;
  r.recvUptime = uptimeS();
  r.boot = bootCount;
  r.ord = (bootCount << 16) | seqNo;
  if (!writeRec(r, pm, "", note)) {             // saved to flash before the resident is told "received"
    r.used = false;
    Serial.println("ERROR: could not save SOS to flash");
    return sendForm("The hotspot could not save your SOS. Please tell the barangay staff here.", contact);
  }
  r.used = true;
  recordHit(ip);
  strlcpy(tokens[ti].rec, r.id, sizeof tokens[ti].rec);
  Serial.printf("New SOS %s from %s (%s), saved\n", r.id, maskContact(r.contact).c_str(), r.type);
  nextSync = 0;                                 // try to send right away
  redirectStatus(slot);
  beep(200); delay(100); beep(200); delay(100); beep(200);
}

void handleStatus() {
  if (!fromAp()) return redirect("/staff");
  int i = findRec(server.arg("id").c_str());
  if (i < 0 || server.arg("k") != recs[i].view) return redirect("/");
  Rec& r = recs[i];
  String h = String("<!doctype html><html><head><title>SOS status</title>") + STYLE;
  if (r.state == 'P') h += "<meta http-equiv=refresh content=5>";
  h += "</head><body><h1>SOS received</h1><div class=card>";
  h += "<p>Number: <b>" + maskContact(r.contact) + "</b></p><p>Emergency: <b>" + String(r.type) + "</b></p>";
  if (r.state == 'P')
    h += "<p class=wait>Saved on the hotspot. Waiting for internet to reach the rescue team...</p><p>It will send by itself, even if you close this page. The barangay staff here can also see it.</p>";
  else if (r.state == 'C')
    h += "<p class=ok>Sent to the rescue team. Help is being arranged.</p><p>Stay where it is safe. Rescuers will go to your registered home location.</p>";
  else if (r.state == 'A')
    h += "<p class=ok>The rescue team already has an active SOS for this number.</p><p>Stay where it is safe. Rescuers will go to your registered home location.</p>";
  else if (r.state == 'N')
    h += "<p class=err>This number is not registered in PriorityCare.</p><p>Please tell the barangay staff here, or try the number you registered with.</p><p><a href=/>Try again</a></p>";
  else
    h += "<p class=err>The hotspot could not send this SOS.</p><p>Please tell the barangay staff here.</p>";
  h += "<p class=muted>Report " + String(r.id) + "</p></div></body></html>";
  noCache();
  server.send(200, "text/html", h);
}

void captive() {     // any other address on the SOS WiFi opens the SOS page
  if (!fromAp()) { server.send(404, "text/plain", "Not found. Staff console: /staff"); return; }
  redirect("http://192.168.4.1/");
}

// ================= Staff console (PIN) =================
bool loggedIn() {
  String c = server.header("Cookie");
  for (int i = 0; i < 3; i++) {
    if (!sessions[i].tok[0] || millis() - sessions[i].at > SESSION_MS) continue;
    if (c.indexOf(String("pcs=") + sessions[i].tok) >= 0) { sessions[i].at = millis(); return true; }
  }
  return false;
}

void sendLogin(const String& msg) {
  String h = String("<!doctype html><html><head><title>Staff login</title>") + STYLE + "</head><body>";
  h += "<h1>Staff console</h1><p>" + htmlEscape(cfg.place) + " &middot; " + deviceId() + "</p>";
  h += "<form class=card method=POST action=/staff/login><b>Staff PIN</b><input name=pin type=password inputmode=numeric autocomplete=current-password>";
  if (msg.length()) h += "<p class=err>" + htmlEscape(msg) + "</p>";
  h += "<button type=submit>Log in</button></form></body></html>";
  noCache();
  server.send(200, "text/html", h);
}

void handleLogin() {
  if (millis() < lockUntil) return sendLogin("Too many wrong PINs. Wait 5 minutes.");
  if (server.arg("pin") != cfg.pin) {
    if (++badPins >= 5) { badPins = 0; lockUntil = millis() + 300000UL; Serial.println("Staff console locked for 5 min (wrong PINs)"); }
    return sendLogin("Wrong PIN.");
  }
  badPins = 0;
  int slot = 0;
  for (int i = 1; i < 3; i++) if (sessions[i].at < sessions[slot].at) slot = i;
  strlcpy(sessions[slot].tok, randomHex(16).c_str(), sizeof sessions[slot].tok);
  sessions[slot].at = millis() | 1;
  server.sendHeader("Set-Cookie", String("pcs=") + sessions[slot].tok + "; Path=/; HttpOnly; SameSite=Strict");
  redirect("/staff");
}

void handleLogout() {
  String c = server.header("Cookie");
  for (int i = 0; i < 3; i++) if (sessions[i].tok[0] && c.indexOf(String("pcs=") + sessions[i].tok) >= 0) { sessions[i].tok[0] = 0; sessions[i].at = 0; }
  server.sendHeader("Set-Cookie", "pcs=; Path=/; Max-Age=0");
  redirect("/staff");
}

void chunk(const String& s) { server.sendContent(s); }

void reportRow(int i) {
  Rec r; String pm, al, nt;
  if (!readRec(recPath(recs[i].id), r, &pm, &al, &nt)) nt = "";
  const char* cls = recs[i].state == 'P' ? "wait" : (recs[i].state == 'C' || recs[i].state == 'A') ? "ok" : "err";
  chunk("<tr><td>" + recTimeText(recs[i]) + "</td><td>" + String(recs[i].contact) + "</td><td>" + String(recs[i].type) +
        "</td><td class=" + cls + ">" + stateText(recs[i].state) + "</td><td>" + htmlEscape(nt) +
        "<br><span class=muted>" + String(recs[i].id) + "</span></td></tr>");
}

void handleStaff() {
  if (!loggedIn()) return sendLogin("");
  bool online = WiFi.status() == WL_CONNECTED;
  noCache();
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "text/html", "");
  chunk(String("<!doctype html><html><head><title>Staff console</title>") + STYLE + "<meta http-equiv=refresh content=20></head><body>");
  chunk("<h1>Staff console</h1><p>" + htmlEscape(cfg.place) + " &middot; <b>" + deviceId() + "</b> &middot; firmware " FW_VERSION "</p>");
  if (!cloudConfigured()) chunk("<p class=err>Not connected to PriorityCare yet. Open Settings and enter the Device ID and secret from the dashboard (ESP32 Devices &gt; Connect ESP32).</p>");

  String g = "<div class=card><div class=grid>";
  g += "<span>Internet WiFi</span><b>" + (online ? String(htmlEscape(WiFi.SSID()) + " (" + String(WiFi.RSSI()) + " dBm)") : String("<span class=err>not connected</span>")) + "</b>";
  g += "<span>Console address</span><b>" + (online ? String("http://" + WiFi.localIP().toString() + "/staff") : String("http://192.168.4.1/staff")) + "</b>";
  g += "<span>PriorityCare</span><b>" + (cloudError.length() ? String("<span class=err>" + htmlEscape(cloudError) + "</span>")
        : everHeartbeat ? String("<span class=ok>reachable</span>, " + agoText(lastHeartbeatOk)) : String("not reached yet")) + "</b>";
  g += "<span>Last sync</span><b>" + (everSync ? agoText(lastSyncOk) : String("none yet")) + "</b>";
  g += "<span>Waiting to send</span><b>" + String(pendingCount()) + "</b>";
  g += "<span>Saved reports</span><b>" + String(reportCount()) + " (storage " + String(storagePct()) + "%)</b>";
  g += "<span>Phones on SOS WiFi</span><b>" + String(WiFi.softAPgetStationNum()) + "</b>";
  g += "<span>Running for</span><b>" + String(uptimeS() / 3600) + " h " + String((uptimeS() / 60) % 60) + " min</b>";
  g += "<span>Free memory</span><b>" + String(ESP.getFreeHeap() / 1024) + " KB</b>";
  g += "</div>";
  g += "<form method=POST action=/staff/sync><button class=sec type=submit>Send waiting reports now</button></form>";
  g += "<p><a href=/staff/setup>Settings</a> &middot; <a href=/staff/logout>Log out</a></p></div>";
  chunk(g);

  chunk("<h2>Waiting to send</h2><div class=card><table><tr><th>Received</th><th>Number</th><th>Type</th><th>Status</th><th>Details</th></tr>");
  int shown = 0;
  for (int i = 0; i < MAX_REPORTS; i++) if (recs[i].used && recs[i].state == 'P') { reportRow(i); shown++; }
  if (!shown) chunk("<tr><td colspan=5 class=muted>None</td></tr>");
  chunk("</table></div>");

  // latest 50 handled reports, newest first
  chunk("<h2>Sent and other reports (latest 50)</h2><div class=card><table><tr><th>Received</th><th>Number</th><th>Type</th><th>Status</th><th>Details</th></tr>");
  uint32_t below = 0xFFFFFFFFUL; shown = 0;
  while (shown < 50) {
    int best = -1;
    for (int i = 0; i < MAX_REPORTS; i++)
      if (recs[i].used && recs[i].state != 'P' && recs[i].ord < below && (best < 0 || recs[i].ord > recs[best].ord)) best = i;
    if (best < 0) break;
    reportRow(best); below = recs[best].ord; shown++;
  }
  if (!shown) chunk("<tr><td colspan=5 class=muted>None</td></tr>");
  chunk("</table></div><p class=muted>This page refreshes every 20 seconds.</p></body></html>");
  chunk("");
}

void handleStaffSync() {
  if (!loggedIn()) return sendLogin("");
  forceSync = true; nextSync = 0; nextHeartbeat = 0; syncDelay = SYNC_MIN_MS;
  redirect("/staff");
}

void sendSetup(const String& msg, bool ok) {
  String h = String("<!doctype html><html><head><title>Settings</title>") + STYLE + "</head><body><h1>Settings</h1>";
  if (msg.length()) h += String("<p class=") + (ok ? "ok" : "err") + ">" + htmlEscape(msg) + "</p>";
  h += "<form class=card method=POST action=/staff/setup>";
  h += "<b>Hotspot location name</b><input name=place maxlength=40 value='" + htmlEscape(cfg.place) + "'>";
  h += "<h2>Internet WiFi (hall router)</h2><b>WiFi name</b><input name=s1 maxlength=32 value='" + htmlEscape(cfg.ssid1) + "'>";
  h += "<b>Password</b> <span class=muted>(" + String(cfg.pass1.length() ? "saved; leave blank to keep" : "none saved") + ")</span><input name=p1 type=password maxlength=63>";
  h += "<label><input type=checkbox name=o1 style='width:auto'> This WiFi has no password</label>";
  h += "<h2>Backup WiFi (optional, e.g. a phone hotspot)</h2><b>WiFi name</b><input name=s2 maxlength=32 value='" + htmlEscape(cfg.ssid2) + "'>";
  h += "<b>Password</b> <span class=muted>(" + String(cfg.pass2.length() ? "saved; leave blank to keep" : "none saved") + ")</span><input name=p2 type=password maxlength=63>";
  h += "<label><input type=checkbox name=o2 style='width:auto'> This WiFi has no password</label>";
  h += "<h2>PriorityCare connection</h2><p class=muted>From the dashboard: ESP32 Devices &gt; Connect ESP32.</p>";
  h += "<b>Device ID</b><input name=gw maxlength=20 placeholder='GW-XXXXXX' value='" + htmlEscape(cfg.gwId) + "'>";
  h += "<b>Device secret</b> <span class=muted>(" + String(cfg.secret.length() ? "saved; leave blank to keep" : "none saved") + ")</span><input name=sec type=password maxlength=64 autocomplete=off>";
  h += "<h2>Staff PIN</h2><b>New PIN (6 to 12 digits, leave blank to keep)</b><input name=pin type=password inputmode=numeric maxlength=12 autocomplete=new-password>";
  h += "<b>New PIN again</b><input name=pin2 type=password inputmode=numeric maxlength=12 autocomplete=new-password>";
  h += "<button type=submit>Save and restart</button></form><p><a href=/staff>Back</a></p></body></html>";
  noCache();
  server.send(200, "text/html", h);
}

void handleSetupGet() { if (!loggedIn()) return sendLogin(""); sendSetup("", false); }

void handleSetupPost() {
  if (!loggedIn()) return sendLogin("");
  String place = server.arg("place"); place.trim();
  String s1 = server.arg("s1"), s2 = server.arg("s2"); s1.trim(); s2.trim();
  String p1 = server.arg("p1"), p2 = server.arg("p2");
  String gw = server.arg("gw"); gw.trim();
  String sec = server.arg("sec"); sec.trim();
  String pin = server.arg("pin"), pin2 = server.arg("pin2");
  if (place.length() < 2 || place.length() > 40) return sendSetup("Enter a location name (2 to 40 characters).", false);
  if (s1.length() > 32 || s2.length() > 32 || p1.length() > 63 || p2.length() > 63) return sendSetup("WiFi name or password is too long.", false);
  if ((p1.length() && p1.length() < 8) || (p2.length() && p2.length() < 8)) return sendSetup("A WiFi password has at least 8 characters.", false);
  if (gw.length() && !validId(gw, 3, 20)) return sendSetup("Device ID: letters, numbers and - only, e.g. GW-1A2B3C.", false);
  if (sec.length() && !validId(sec, 8, 64)) return sendSetup("Device secret looks wrong. Copy it exactly from the dashboard.", false);
  if (pin.length() && (!allDigits(pin) || pin.length() < 6 || pin.length() > 12)) return sendSetup("PIN must be 6 to 12 digits.", false);
  if (pin != pin2) return sendSetup("The two PINs do not match.", false);

  prefs.begin("pc", false);
  prefs.putString("place", place);
  prefs.putString("ssid1", s1);
  if (server.hasArg("o1")) prefs.putString("pass1", ""); else if (p1.length()) prefs.putString("pass1", p1);
  prefs.putString("ssid2", s2);
  if (server.hasArg("o2")) prefs.putString("pass2", ""); else if (p2.length()) prefs.putString("pass2", p2);
  prefs.putString("gwid", gw);
  if (sec.length()) prefs.putString("secret", sec);
  if (!gw.length()) prefs.putString("secret", "");
  if (pin.length()) { prefs.putString("pin", pin); prefs.putBool("pinchanged", true); }
  prefs.end();
  Serial.println("Settings saved from the staff console. Restarting...");
  String h = String("<!doctype html><html><head><title>Saved</title>") + STYLE + "</head><body><h1>Saved</h1><div class=card>"
             "<p class=ok>Settings saved. The hotspot is restarting.</p><p>Saved SOS reports are kept. Open the console again in about 20 seconds.</p></div></body></html>";
  server.send(200, "text/html", h);
  delay(1500);
  ESP.restart();
}

// ================= PriorityCare (Supabase) =================
// Find "key": value in s between from and to (to < 0 = end). Returns the position after the value or -1.
int jsonFind(const String& s, const char* key, int from, int to, String& out) {
  String k = String("\"") + key + "\"";
  int p = s.indexOf(k, from);
  if (p < 0 || (to >= 0 && p >= to)) return -1;
  p = s.indexOf(':', p + k.length());
  if (p < 0) return -1;
  p++;
  int len = s.length();
  while (p < len && s[p] == ' ') p++;
  if (p >= len) return -1;
  if (s[p] == '"') {
    String v; int e = p + 1;
    while (e < len && s[e] != '"') { if (s[e] == '\\' && e + 1 < len) e++; v += s[e]; e++; }
    out = v; return e + 1;
  }
  int e = p;
  while (e < len && s[e] != ',' && s[e] != '}' && s[e] != ']') e++;
  out = s.substring(p, e); out.trim();
  return e;
}

String authJson() {
  return String("{\"p_gateway_id\":\"") + jsonEscape(cfg.gwId) + "\",\"p_key\":\"" + jsonEscape(cfg.secret) + "\"";
}

// HTTP status code, or -1 if there was no connection
int rpc(const char* fn, const String& body, String& resp) {
  resp = "";
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
  client.setInsecure();      // remaining gap: the server certificate is not checked
  HTTPClient http;
  http.setConnectTimeout(6000);
  http.setTimeout(8000);
  if (!http.begin(client, String(SUPABASE_RPC) + fn)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  int code = http.POST(body);
  if (code > 0) resp = http.getString();
  http.end();
  return code;
}

void noteCloudError(int code, const String& resp) {
  if (code < 0) cloudError = "cannot reach PriorityCare (no internet on this WiFi?)";
  else if (resp.indexOf("SUSPENDED") >= 0) cloudError = "disconnected by an admin in the dashboard";
  else if (resp.indexOf("BAD_GATEWAY") >= 0) cloudError = "Device ID or secret is wrong (Settings)";
  else cloudError = "PriorityCare error " + String(code);
  Serial.printf("PriorityCare: %s (%d) %s\n", cloudError.c_str(), code, resp.substring(0, 160).c_str());
}

void ackCommand(const String& id, const char* result) {
  String resp;
  int code = rpc("gateway_ack_command", authJson() + ",\"p_command_id\":" + id + ",\"p_result\":\"" + result + "\"}", resp);
  Serial.printf("Command %s acknowledged (%d)\n", id.c_str(), code);
}

void heartbeat() {
  String st = String("{\"sta_ip\":\"") + WiFi.localIP().toString() + "\",\"wifi_ssid\":\"" + jsonEscape(WiFi.SSID()) +
              "\",\"wifi_rssi\":" + String(WiFi.RSSI()) + ",\"fw\":\"" FW_VERSION "\",\"uptime_s\":" + String(uptimeS()) +
              ",\"boot\":" + String(bootCount) + ",\"free_heap\":" + String(ESP.getFreeHeap()) +
              ",\"storage_pct\":" + String(storagePct()) + ",\"pending\":" + String(pendingCount()) +
              ",\"clients\":" + String(WiFi.softAPgetStationNum()) + "}";
  String resp;
  int code = rpc("gateway_heartbeat", authJson() + ",\"p_status\":" + st + "}", resp);
  if (code != 200) { noteCloudError(code, resp); return; }
  cloudError = ""; lastHeartbeatOk = millis(); everHeartbeat = true;

  String v;
  if (!clockValid() && jsonFind(resp, "server_time", 0, -1, v) > 0) {
    struct timeval tv = { (time_t)strtoul(v.c_str(), nullptr, 10), 0 };
    if (tv.tv_sec > 1700000000) { settimeofday(&tv, nullptr); Serial.println("Clock set from PriorityCare"); }
  }

  // commands: [{"id": 5, "command": "resync"}, ...]
  int p = resp.indexOf("\"commands\"");
  bool reboot = false;
  while (p >= 0) {
    String id, cmd;
    int q = jsonFind(resp, "id", p, -1, id);
    if (q < 0) break;
    int next = resp.indexOf("\"id\"", q);
    if (jsonFind(resp, "command", q, next, cmd) < 0) { p = q; continue; }
    Serial.printf("Command from dashboard: %s (#%s)\n", cmd.c_str(), id.c_str());
    if (cmd == "resync") { forceSync = true; nextSync = 0; syncDelay = SYNC_MIN_MS; ackCommand(id, "done"); }
    else if (cmd == "reboot") { ackCommand(id, "rebooting"); reboot = true; }
    else ackCommand(id, "unknown command");
    p = q;
  }
  if (reboot) { Serial.println("Restarting (dashboard asked)"); delay(500); ESP.restart(); }
}

void syncReports() {
  // up to SYNC_BATCH oldest waiting reports
  int pick[SYNC_BATCH]; int n = 0; uint32_t above = 0; bool first = true;
  while (n < SYNC_BATCH) {
    int best = -1;
    for (int i = 0; i < MAX_REPORTS; i++)
      if (recs[i].used && recs[i].state == 'P' && (first || recs[i].ord > above) && (best < 0 || recs[i].ord < recs[best].ord)) best = i;
    if (best < 0) break;
    pick[n++] = best; above = recs[best].ord; first = false;
  }
  if (!n) { forceSync = false; return; }

  String arr = "[";
  for (int k = 0; k < n; k++) {
    Rec& r = recs[pick[k]];
    Rec tmp; String pm, al, nt;
    if (!readRec(recPath(r.id), tmp, &pm, &al, &nt)) { pm = ""; nt = ""; }
    uint32_t re = recvEpochOf(r);
    if (k) arr += ",";
    arr += String("{\"id\":\"") + r.id + "\",\"contact\":\"" + r.contact + "\",\"type\":\"" + r.type +
           "\",\"note\":\"" + jsonEscape(nt) + "\",\"phone_ms\":\"" + pm + "\",\"received_s\":\"" + (re ? String(re) : String("")) +
           "\",\"uptime_s\":\"" + String(r.recvUptime) + "\"}";
  }
  arr += "]";

  String resp;
  int code = rpc("gateway_sync", authJson() + ",\"p_reports\":" + arr + "}", resp);
  if (code != 200) {
    noteCloudError(code, resp);
    syncDelay = min(syncDelay * 2, SYNC_MAX_MS);
    nextSync = millis() + syncDelay;
    Serial.printf("Sync failed, %d report(s) kept, next try in %lu s\n", n, syncDelay / 1000);
    return;
  }
  cloudError = ""; lastSyncOk = millis(); everSync = true; syncDelay = SYNC_MIN_MS;

  // results: [{"id": "...", "reason": "...", "result": "created", "alert_id": "..."}, ...]
  int p = resp.indexOf("\"results\"");
  int done = 0;
  while (p >= 0) {
    String id, result, alert;
    int q = jsonFind(resp, "id", p, -1, id);
    if (q < 0) break;
    int next = resp.indexOf("\"id\"", q);
    jsonFind(resp, "result", q, next, result);
    jsonFind(resp, "alert_id", q, next, alert);
    if (alert == "null") alert = "";
    int i = findRec(id.c_str());
    char st = 0;
    if (result == "created") st = 'C';
    else if (result == "already_active") st = 'A';
    else if (result == "not_registered") st = 'N';
    else if (result == "rejected") st = 'R';
    if (i >= 0 && st) {               // anything else ("retry") stays saved and is sent again
      if (!setState(i, st, alert)) Serial.printf("WARNING: could not update %s in flash\n", id.c_str());
      Serial.printf("Report %s -> %s\n", id.c_str(), result.c_str());
      done++;
      if (st == 'C') beep(100);
    }
    p = q;
  }
  int left = pendingCount();
  nextSync = millis() + (left && done ? 1000 : SYNC_MIN_MS);
  if (!left) forceSync = false;
  if (done) nextHeartbeat = millis() + 2000;     // let the dashboard see the new pending count soon
}

// ================= Internet WiFi =================
// Search for the internet WiFi for at most 15 s, then rest 45 s. While searching the ESP32 changes
// channel, which drops phones from the SOS WiFi, so it must never search non-stop.
void manageInternetWifi() {
  if (WiFi.status() == WL_CONNECTED) { connecting = false; return; }
  if (!cfg.ssid1.length() && !cfg.ssid2.length()) return;
  if (connecting && millis() - connectStart > WIFI_TRY_MS) {
    Serial.println("Internet WiFi not found, trying again in 45 s");
    WiFi.disconnect(false);
    connecting = false;
    wifiTimer = millis();
    wifiIdx ^= 1;
  } else if (!connecting && millis() - wifiTimer > WIFI_REST_MS) {
    if (wifiIdx == 1 && !cfg.ssid2.length()) wifiIdx = 0;
    if (wifiIdx == 0 && !cfg.ssid1.length()) wifiIdx = 1;
    const String& ss = wifiIdx ? cfg.ssid2 : cfg.ssid1;
    const String& pw = wifiIdx ? cfg.pass2 : cfg.pass1;
    Serial.printf("Connecting to internet WiFi \"%s\"...\n", ss.c_str());
    if (pw.length()) WiFi.begin(ss.c_str(), pw.c_str()); else WiFi.begin(ss.c_str());
    connecting = true;
    connectStart = millis();
  }
}

// ================= Setup and loop =================
void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  Serial.println("\nPriorityCare SOS Hotspot v" FW_VERSION);

  if (!LittleFS.begin(true)) Serial.println("ERROR: flash storage failed. Reports cannot be saved.");
  loadConfig();
  loadReports();

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.setAutoReconnect(false);                      // reconnects are done gently in manageInternetWifi()
  bool apOk = WiFi.softAP(HOTSPOT_NAME, nullptr, 1, 0, 10);   // open, up to 10 phones
  Serial.printf("SOS WiFi \"%s\" %s, IP %s\n", HOTSPOT_NAME, apOk ? "on" : "FAILED", WiFi.softAPIP().toString().c_str());
  configTime(8 * 3600, 0, "pool.ntp.org", "time.google.com");   // Philippine time once online
  wifiTimer = millis() - WIFI_REST_MS;               // first internet attempt right away

  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", WiFi.softAPIP());
  const char* hdrs[] = { "Cookie" };
  server.collectHeaders(hdrs, 1);
  server.on("/", handleRoot);
  server.on("/sos", HTTP_POST, handleSos);
  server.on("/status", handleStatus);
  server.on("/staff", handleStaff);
  server.on("/staff/login", HTTP_POST, handleLogin);
  server.on("/staff/logout", handleLogout);
  server.on("/staff/sync", HTTP_POST, handleStaffSync);
  server.on("/staff/setup", HTTP_GET, handleSetupGet);
  server.on("/staff/setup", HTTP_POST, handleSetupPost);
  server.on("/generate_204", captive);               // Android
  server.on("/gen_204", captive);                    // Android
  server.on("/hotspot-detect.html", handleRoot);     // iPhone
  server.on("/connecttest.txt", captive);            // Windows
  server.onNotFound(captive);
  server.begin();

  Serial.printf("Device: %s  %s\n", deviceId().c_str(), cloudConfigured() ? "(connected to PriorityCare)" : "(not set up yet: join the SOS WiFi and open http://192.168.4.1/staff)");
  if (!cfg.ssid1.length() && !cfg.ssid2.length()) Serial.println("No internet WiFi saved yet. Set it on the staff Settings page.");
}

void loop() {
  dns.processNextRequest();
  server.handleClient();

  // Hold BOOT 10 s = reset settings (reports are kept)
  if (digitalRead(PIN_BOOT) == LOW) {
    if (!bootHeldSince) bootHeldSince = millis() | 1;
    else if (millis() - bootHeldSince > 10000) resetSettings();
  } else bootHeldSince = 0;

  bool online = WiFi.status() == WL_CONNECTED;
  if (online != wasOnline) {
    wasOnline = online;
    if (online) {
      Serial.printf("Internet WiFi \"%s\" connected. Staff console: http://%s/staff\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
      nextHeartbeat = 0; nextSync = 0; syncDelay = SYNC_MIN_MS;
    } else Serial.println("Internet WiFi lost. SOS reports are kept and sent later.");
  }
  manageInternetWifi();

  if (online && cloudConfigured()) {
    if ((long)(millis() - nextHeartbeat) >= 0) { nextHeartbeat = millis() + HEARTBEAT_MS; heartbeat(); }
    else if ((pendingCount() || forceSync) && (long)(millis() - nextSync) >= 0) syncReports();
  }

  if (pendingCount()) {
    if (millis() - ledTimer > 120) { ledTimer = millis(); ledOn = !ledOn; digitalWrite(PIN_LED, ledOn); }
  } else if (online) {
    digitalWrite(PIN_LED, HIGH);
  } else if (millis() - ledTimer > 800) {
    ledTimer = millis(); ledOn = !ledOn; digitalWrite(PIN_LED, ledOn);
  }
}
