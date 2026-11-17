/*
  PriorityCare SOS gateway (barangay hall / command post)
  Board : ESP32 Dev Module
  Radio : SX1276/SX1278 LoRa module (same wiring as the node)
  Library: "LoRa" by Sandeep Mistry. WiFi, HTTPClient and WiFiClientSecure come with the ESP32 core.

  What it does:
    1. Listens for SOS packets from household buttons over LoRa.
    2. Answers each one with an ACK right away, so the button stops resending.
    3. Sends the SOS to Supabase (device_sos) over WiFi. If there is no internet,
       it keeps the SOS in a queue and retries every 10 seconds until it goes through.
  The SOS then shows on the admin dashboard like an SOS from the app.

  LED: solid = WiFi connected, slow blink = no WiFi, quick flash = SOS received.
  Buzzer (optional, GPIO27): beeps on every new SOS so people at the hall hear it
  even when the internet is down. Serial Monitor (115200) prints every event.
*/
#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ---- Change these ----
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* GATEWAY_ID    = "GW-01";                    // must match sos_gateways.gateway_id
const char* GATEWAY_KEY   = "CHANGE-ME-long-random-secret"; // the secret you hashed into sos_gateways
const char* NETWORK_KEY   = "pc-cordova-2026";          // same value in every node sketch
const long  LORA_FREQ     = 433E6;                      // must match the nodes

const char* SUPABASE_RPC  = "https://urioaayowijvhwbuxxaj.supabase.co/rest/v1/rpc/device_sos";
const char* SUPABASE_KEY  = "sb_publishable_4U89GUwsifai0yHblicJ-w_iQifQfkS"; // public key, same as the app

const int PIN_SCK = 18, PIN_MISO = 19, PIN_MOSI = 23, PIN_SS = 5, PIN_RST = 14, PIN_DIO0 = 26;
const int PIN_LED = 2, PIN_BUZZER = 27;

// ---- Queue of SOS waiting to reach Supabase ----
struct Pending { bool used; String node; String type; uint32_t seq; int rssi; unsigned long nextTry; int attempts; };
const int QUEUE_SIZE = 16;
Pending queueBuf[QUEUE_SIZE];

// Remember the last seq per node so resends are not queued twice
struct Seen { String node; uint32_t seq; };
const int SEEN_SIZE = 32;
Seen seen[SEEN_SIZE];
int seenNext = 0;

unsigned long ledTimer = 0, wifiTimer = 0;

bool alreadySeen(const String& node, uint32_t seq) {
  for (int i = 0; i < SEEN_SIZE; i++) if (seen[i].node == node && seen[i].seq == seq) return true;
  seen[seenNext] = { node, seq };
  seenNext = (seenNext + 1) % SEEN_SIZE;
  return false;
}

bool validText(const String& s) {          // keep IDs safe to put in JSON
  if (s.length() == 0 || s.length() > 32) return false;
  for (char c : s) if (!isalnum(c) && c != '-' && c != '_') return false;
  return true;
}

void sendAck(const String& node, uint32_t seq) {
  delay(50);
  LoRa.beginPacket();
  LoRa.print("ACK|"); LoRa.print(node); LoRa.print("|"); LoRa.print(seq);
  LoRa.endPacket();
  LoRa.receive();
}

void enqueue(const String& node, const String& type, uint32_t seq, int rssi) {
  for (int i = 0; i < QUEUE_SIZE; i++) {
    if (!queueBuf[i].used) { queueBuf[i] = { true, node, type, seq, rssi, 0, 0 }; return; }
  }
  Serial.println("Queue full! SOS kept only on the buzzer/serial log: " + node);
}

void handleLoRa() {
  int size = LoRa.parsePacket();
  if (!size) return;
  String msg;
  while (LoRa.available()) msg += (char)LoRa.read();
  int rssi = LoRa.packetRssi();

  // PC1|<key>|<node>|<seq>|<type>
  String parts[5]; int n = 0, start = 0;
  for (int i = 0; i <= (int)msg.length() && n < 5; i++) {
    if (i == (int)msg.length() || msg[i] == '|') { parts[n++] = msg.substring(start, i); start = i + 1; }
  }
  if (n != 5 || parts[0] != "PC1" || parts[1] != NETWORK_KEY) return;   // not ours
  String node = parts[2], type = parts[4];
  uint32_t seq = (uint32_t)parts[3].toInt();
  if (!validText(node) || !validText(type)) return;

  sendAck(node, seq);
  digitalWrite(PIN_LED, !digitalRead(PIN_LED));
  if (alreadySeen(node, seq)) return;                                    // a resend we already have

  Serial.printf("SOS from %s (type %s, seq %u, RSSI %d dBm)\n", node.c_str(), type.c_str(), seq, rssi);
  for (int i = 0; i < 3; i++) { digitalWrite(PIN_BUZZER, HIGH); delay(200); digitalWrite(PIN_BUZZER, LOW); delay(100); }
  enqueue(node, type, seq, rssi);
}

// Returns 1 = delivered, 0 = retry later, -1 = rejected (do not retry)
int postSos(const Pending& p) {
  if (WiFi.status() != WL_CONNECTED) return 0;
  WiFiClientSecure client;
  client.setInsecure();   // pilot only: skips certificate check. Pin the CA for production.
  HTTPClient http;
  if (!http.begin(client, SUPABASE_RPC)) return 0;
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  String body = String("{\"p_gateway_id\":\"") + GATEWAY_ID +
                "\",\"p_gateway_key\":\"" + GATEWAY_KEY +
                "\",\"p_node_id\":\"" + p.node +
                "\",\"p_type\":\"" + p.type +
                "\",\"p_rssi\":" + String(p.rssi) + "}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("Supabase %d: %s\n", code, resp.c_str());
  if (code == 200) return 1;
  if (code >= 400 && code < 500) return -1;   // e.g. button not registered, wrong gateway key
  return 0;                                   // network error or server error
}

void flushQueue() {
  for (int i = 0; i < QUEUE_SIZE; i++) {
    Pending& p = queueBuf[i];
    if (!p.used || millis() < p.nextTry) continue;
    int r = postSos(p);
    if (r == 1) { Serial.println("Delivered SOS from " + p.node); p.used = false; }
    else if (r == -1) { Serial.println("Rejected SOS from " + p.node + " (check registration)"); p.used = false; }
    else { p.attempts++; p.nextTry = millis() + 10000; }
    return;   // one HTTP call per loop so LoRa keeps being heard
  }
}

void keepWifi() {
  bool up = WiFi.status() == WL_CONNECTED;
  if (!up && millis() - wifiTimer > 15000) {
    wifiTimer = millis();
    Serial.println("Connecting WiFi...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
  if (up) digitalWrite(PIN_LED, HIGH);
  else if (millis() - ledTimer > 800) { ledTimer = millis(); digitalWrite(PIN_LED, !digitalRead(PIN_LED)); }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_SS);
  LoRa.setPins(PIN_SS, PIN_RST, PIN_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("LoRa init failed. Check wiring and frequency.");
    while (true) { digitalWrite(PIN_LED, !digitalRead(PIN_LED)); delay(100); }
  }
  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setSyncWord(0x5C);
  LoRa.setTxPower(17);
  LoRa.enableCrc();
  LoRa.receive();
  Serial.printf("PriorityCare gateway %s listening\n", GATEWAY_ID);
}

void loop() {
  handleLoRa();
  keepWifi();
  flushQueue();
}
