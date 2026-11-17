/*
  PriorityCare offline SOS button (household node)
  Board : ESP32 Dev Module
  Radio : SX1276/SX1278 LoRa module (e.g. Ai-Thinker Ra-02)
  Library: "LoRa" by Sandeep Mistry  (Arduino IDE > Library Manager)

  Hold the SOS button for 2 seconds. The node sends the SOS over LoRa and
  repeats it until the gateway answers with an ACK.
    LED blinking fast = sending, waiting for gateway
    LED solid on      = gateway received it (SOS is on its way to the dashboard)
    LED slow blink    = gave up after MAX_TRIES, press again

  Wiring (ESP32 -> Ra-02):
    3.3V -> VCC   (NOT 5V)      GND -> GND
    GPIO18 -> SCK   GPIO19 -> MISO   GPIO23 -> MOSI
    GPIO5  -> NSS   GPIO14 -> RST    GPIO26 -> DIO0
  SOS button: GPIO4 to GND (uses the internal pull-up)
  LED: GPIO2 (the on-board LED on most dev boards)
  Optional buzzer: GPIO27 to buzzer +, buzzer - to GND
  Always attach the antenna before powering the LoRa module.
*/
#include <SPI.h>
#include <LoRa.h>

// ---- Change these per button ----
const char* NODE_ID     = "NODE-001";        // must match sos_devices.node_id
const char* NETWORK_KEY = "pc-cordova-2026"; // same value in the gateway sketch
const char* SOS_TYPE    = "OTHER";           // FLOOD, FIRE, MEDICAL, TRAPPED or OTHER
const long  LORA_FREQ   = 433E6;             // 433E6 for Ra-02; use 915E6/923E6 if your module is that band

// ---- Pins ----
const int PIN_SCK = 18, PIN_MISO = 19, PIN_MOSI = 23, PIN_SS = 5, PIN_RST = 14, PIN_DIO0 = 26;
const int PIN_BUTTON = 4, PIN_LED = 2, PIN_BUZZER = 27;

const unsigned long HOLD_MS   = 2000;  // hold time to avoid accidental presses
const unsigned long RETRY_MS  = 3000;  // resend interval while waiting for ACK
const int           MAX_TRIES = 40;    // about 2 minutes of retries

enum State { IDLE, SENDING, DELIVERED, FAILED };
State state = IDLE;
uint32_t seq = 0;
int tries = 0;
unsigned long lastSend = 0, pressStart = 0, ledTimer = 0;
bool ledOn = false;

void beep(int ms) { digitalWrite(PIN_BUZZER, HIGH); delay(ms); digitalWrite(PIN_BUZZER, LOW); }

void sendSos() {
  // Packet: PC1|<key>|<node>|<seq>|<type>
  LoRa.beginPacket();
  LoRa.print("PC1|"); LoRa.print(NETWORK_KEY); LoRa.print("|");
  LoRa.print(NODE_ID); LoRa.print("|"); LoRa.print(seq); LoRa.print("|"); LoRa.print(SOS_TYPE);
  LoRa.endPacket();
  LoRa.receive();
  tries++;
  lastSend = millis();
  Serial.printf("SOS sent, seq %u, try %d\n", seq, tries);
}

void checkAck() {
  int size = LoRa.parsePacket();
  if (!size) return;
  String msg;
  while (LoRa.available()) msg += (char)LoRa.read();
  // Expected: ACK|<node>|<seq>
  String want = String("ACK|") + NODE_ID + "|" + String(seq);
  if (msg == want) {
    state = DELIVERED;
    digitalWrite(PIN_LED, HIGH);
    Serial.println("Gateway ACK received");
    beep(150); delay(100); beep(150);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_SS);
  LoRa.setPins(PIN_SS, PIN_RST, PIN_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("LoRa init failed. Check wiring and frequency.");
    while (true) { digitalWrite(PIN_LED, !digitalRead(PIN_LED)); delay(100); }
  }
  // Same radio settings on node and gateway. SF10 trades speed for range.
  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setSyncWord(0x5C);
  LoRa.setTxPower(17);
  LoRa.enableCrc();
  LoRa.receive();
  randomSeed(esp_random());
  seq = esp_random() % 100000;   // new sequence each boot so old ACKs don't match
  Serial.printf("PriorityCare node %s ready\n", NODE_ID);
}

void loop() {
  // Long-press detection
  if (digitalRead(PIN_BUTTON) == LOW) {
    if (pressStart == 0) pressStart = millis();
    if (millis() - pressStart >= HOLD_MS && state != SENDING) {
      seq++;
      tries = 0;
      state = SENDING;
      beep(300);
      sendSos();
    }
  } else {
    pressStart = 0;
  }

  if (state == SENDING) {
    checkAck();
    if (state == SENDING && millis() - lastSend >= RETRY_MS + random(0, 1000)) {
      if (tries >= MAX_TRIES) { state = FAILED; Serial.println("No gateway reply, giving up"); }
      else sendSos();
    }
    if (millis() - ledTimer > 120) { ledTimer = millis(); ledOn = !ledOn; digitalWrite(PIN_LED, ledOn); }
  } else if (state == FAILED) {
    if (millis() - ledTimer > 800) { ledTimer = millis(); ledOn = !ledOn; digitalWrite(PIN_LED, ledOn); }
  }
}
