/*
 * Smart Locker — ESP32 Wokwi
 * Khớp config.py: LOCKER_COUNT=3, MQTT_TOPIC_PREFIX=smart-locker/demo
 *
 * Topics:
 *   Subscribe: .../lockers/+/command, .../lockers/occupancy
 *   Publish:   .../lockers/{id}/status, .../device/status
 *
 * LED: sáng liên tục khi tủ "đang sử dụng" (occupancy hoặc sau GUI_DO)
 * action: GUI_DO | LAY_DO | MANUAL
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <ESP32PWM.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

const char* MQTT_HOST = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char* MQTT_TOPIC_PREFIX = "smart-locker/demo";
const char* DEVICE_ID = "wokwi-esp32-locker";

const int LOCKER_COUNT = 3;
const int LED_PINS[LOCKER_COUNT] = {2, 4, 15};
// Tránh GPIO 5 (hay xung đột PWM/WiFi trên ESP32). Khớp diagram.json.
const int SERVO_PINS[LOCKER_COUNT] = {18, 13, 17};
const int BUZZER_PIN = 23;
const int LCD_COLUMNS = 16;
const int LCD_ROWS = 2;
const int SERVO_CLOSED_DEG = 20;
const int SERVO_OPEN_DEG = 160;
const int SERVO_ATTACH_MIN_US = 500;
const int SERVO_ATTACH_MAX_US = 2500;
const unsigned long OPEN_HOLD_MS = 2200;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
Servo lockerServos[LOCKER_COUNT];
LiquidCrystal_I2C lcd(0x27, LCD_COLUMNS, LCD_ROWS);

unsigned long lastReconnectAttempt = 0;
unsigned long lastHeartbeatSentAt = 0;
bool lockerPhysicallyOpen[LOCKER_COUNT] = {false, false, false};
bool lockerInUse[LOCKER_COUNT] = {false, false, false};

String topicDeviceStatus() {
  return String(MQTT_TOPIC_PREFIX) + "/device/status";
}

String topicLockerStatus(int lockerId) {
  return String(MQTT_TOPIC_PREFIX) + "/lockers/" + lockerId + "/status";
}

String topicCommandSubscription() {
  return String(MQTT_TOPIC_PREFIX) + "/lockers/+/command";
}

String topicOccupancy() {
  return String(MQTT_TOPIC_PREFIX) + "/lockers/occupancy";
}

int lockerIndex(int lockerId) {
  if (lockerId < 1 || lockerId > LOCKER_COUNT) return -1;
  return lockerId - 1;
}

void setLcd(const String& line1, const String& line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 16));
}

void beepSuccess() {
  tone(BUZZER_PIN, 880, 120);
  delay(150);
  tone(BUZZER_PIN, 1175, 180);
}

void applyLockerLeds() {
  for (int i = 0; i < LOCKER_COUNT; i++) {
    bool on = lockerInUse[i] || lockerPhysicallyOpen[i];
    digitalWrite(LED_PINS[i], on ? HIGH : LOW);
  }
}

void writeServoAngle(int idx, int angle) {
  angle = constrain(angle, SERVO_CLOSED_DEG, SERVO_OPEN_DEG);
  lockerServos[idx].write(angle);
}

void animateServoTo(int idx, int targetAngle) {
  int from = (targetAngle == SERVO_OPEN_DEG) ? SERVO_CLOSED_DEG : SERVO_OPEN_DEG;
  int step = (targetAngle > from) ? 8 : -8;
  for (int a = from; step > 0 ? a <= targetAngle : a >= targetAngle; a += step) {
    writeServoAngle(idx, a);
    mqttClient.loop();
    delay(25);
  }
  writeServoAngle(idx, targetAngle);
}

void closeAllServos() {
  for (int i = 0; i < LOCKER_COUNT; i++) {
    writeServoAngle(i, SERVO_CLOSED_DEG);
    lockerPhysicallyOpen[i] = false;
  }
  applyLockerLeds();
}

void setLockerInUse(int lockerId, bool inUse) {
  int idx = lockerIndex(lockerId);
  if (idx < 0) return;
  lockerInUse[idx] = inUse;
  applyLockerLeds();
}

void handleOccupancy(byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload, length)) return;

  JsonObject lockers = doc["lockers"];
  if (lockers.isNull()) return;

  for (int i = 0; i < LOCKER_COUNT; i++) {
    String key = String(i + 1);
    if (lockers.containsKey(key)) {
      lockerInUse[i] = lockers[key];
    }
  }
  applyLockerLeds();
  Serial.println("[MQTT] occupancy synced");
}

void lcdForOpen(const char* action, int lockerId) {
  String tu = "TU " + String(lockerId);
  if (strcmp(action, "GUI_DO") == 0) {
    setLcd("GUI DO - " + tu, "Dat do vao tu");
  } else if (strcmp(action, "LAY_DO") == 0) {
    setLcd("LAY DO - " + tu, "Lay do ra");
  } else if (strcmp(action, "MANUAL") == 0) {
    setLcd("MO THU CONG", tu);
  } else {
    setLcd(">>> MO " + tu, "Dang mo...");
  }
}

void lcdForClosed(const char* action, int lockerId) {
  String tu = "Tu " + String(lockerId);
  if (strcmp(action, "GUI_DO") == 0) {
    setLcd(tu + " da dong", "Dang su dung");
  } else if (strcmp(action, "LAY_DO") == 0) {
    setLcd("Lay do xong", tu + " trong");
  } else {
    setLcd(tu + " da dong", "San sang");
  }
}

void publishDeviceStatus(bool online) {
  StaticJsonDocument<384> doc;
  doc["device_id"] = DEVICE_ID;
  doc["online"] = online;
  doc["locker_count"] = LOCKER_COUNT;
  JsonArray inUseArr = doc.createNestedArray("lockers_in_use");
  for (int i = 0; i < LOCKER_COUNT; i++) {
    if (lockerInUse[i]) inUseArr.add(i + 1);
  }
  doc["ip"] = WiFi.localIP().toString();
  doc["sent_at"] = millis();
  char payload[384];
  serializeJson(doc, payload);
  mqttClient.publish(topicDeviceStatus().c_str(), payload, true);
}

void publishLockerStatus(
  int lockerId,
  const char* state,
  const char* requestId,
  const char* action,
  bool ok,
  const char* message
) {
  StaticJsonDocument<320> doc;
  doc["device_id"] = DEVICE_ID;
  doc["locker_id"] = lockerId;
  doc["state"] = state;
  doc["action"] = action;
  doc["request_id"] = requestId;
  doc["ok"] = ok;
  doc["message"] = message;
  doc["sent_at"] = millis();
  char payload[320];
  serializeJson(doc, payload);
  mqttClient.publish(topicLockerStatus(lockerId).c_str(), payload, true);
}

void openLockerSequence(int lockerId, const char* requestId, const char* action) {
  int idx = lockerIndex(lockerId);
  if (idx < 0) return;

  Serial.print("[MQTT] open tu ");
  Serial.print(lockerId);
  Serial.print(" action=");
  Serial.println(action);

  closeAllServos();
  Serial.print("  servo ");
  Serial.print(SERVO_PINS[idx]);
  Serial.println(" opening...");
  animateServoTo(idx, SERVO_OPEN_DEG);
  lockerPhysicallyOpen[idx] = true;
  applyLockerLeds();
  lcdForOpen(action, lockerId);
  beepSuccess();
  publishLockerStatus(lockerId, "opened", requestId, action, true, "Locker opened");

  unsigned long t0 = millis();
  while (millis() - t0 < OPEN_HOLD_MS) {
    mqttClient.loop();
    delay(20);
  }

  animateServoTo(idx, SERVO_CLOSED_DEG);
  lockerPhysicallyOpen[idx] = false;

  if (strcmp(action, "GUI_DO") == 0) {
    setLockerInUse(lockerId, true);
  } else if (strcmp(action, "LAY_DO") == 0) {
    setLockerInUse(lockerId, false);
  } else {
    applyLockerLeds();
  }

  lcdForClosed(action, lockerId);
  publishLockerStatus(lockerId, "closed", requestId, action, true, "Locker closed");
  setLcd("3 tu san sang", "Gui do / Lay do");
  publishDeviceStatus(true);
}

int lockerIdFromTopic(const String& topic) {
  const String prefix = String(MQTT_TOPIC_PREFIX) + "/lockers/";
  if (!topic.startsWith(prefix) || !topic.endsWith("/command")) return -1;
  String part = topic.substring(prefix.length());
  part.remove(part.indexOf("/"));
  return part.toInt();
}

void handleCommand(const String& topic, byte* payload, unsigned int length) {
  int lockerId = lockerIdFromTopic(topic);
  if (lockerIndex(lockerId) < 0) return;

  StaticJsonDocument<320> doc;
  if (deserializeJson(doc, payload, length)) {
    publishLockerStatus(lockerId, "error", "", "UNKNOWN", false, "Invalid JSON");
    return;
  }

  const char* command = doc["command"] | "";
  const char* requestId = doc["request_id"] | "";
  const char* action = doc["action"] | "MANUAL";
  int payloadLockerId = doc["locker_id"] | 0;

  if (payloadLockerId > 0 && payloadLockerId != lockerId) {
    publishLockerStatus(lockerId, "error", requestId, action, false, "locker_id mismatch");
    return;
  }
  if (strcmp(command, "open") != 0) {
    publishLockerStatus(lockerId, "ignored", requestId, action, false, "Unsupported command");
    return;
  }

  openLockerSequence(lockerId, requestId, action);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  if (topicStr == topicOccupancy()) {
    handleOccupancy(payload, length);
    return;
  }
  if (topicStr.endsWith("/command")) {
    handleCommand(topicStr, payload, length);
  }
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);
  while (WiFi.status() != WL_CONNECTED) {
    delay(200);
    Serial.print(".");
  }
  Serial.println(" OK");
}

bool ensureMqtt() {
  if (mqttClient.connected()) return true;

  unsigned long now = millis();
  if (now - lastReconnectAttempt < 2000) return false;
  lastReconnectAttempt = now;

  String clientId = String(DEVICE_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print("MQTT");
  if (!mqttClient.connect(clientId.c_str())) {
    Serial.print(" fail ");
    Serial.println(mqttClient.state());
    return false;
  }
  Serial.println(" OK");
  mqttClient.subscribe(topicCommandSubscription().c_str(), 1);
  mqttClient.subscribe(topicOccupancy().c_str(), 1);
  publishDeviceStatus(true);
  setLcd("He thong san sang", "Gui do / Lay do");
  return true;
}

void setup() {
  Serial.begin(115200);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  for (int i = 0; i < LOCKER_COUNT; i++) {
    pinMode(LED_PINS[i], OUTPUT);
    digitalWrite(LED_PINS[i], LOW);
    lockerServos[i].setPeriodHertz(50);
    lockerServos[i].attach(
      SERVO_PINS[i],
      SERVO_ATTACH_MIN_US,
      SERVO_ATTACH_MAX_US
    );
    writeServoAngle(i, SERVO_CLOSED_DEG);
    delay(200);
  }
  pinMode(BUZZER_PIN, OUTPUT);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  setLcd("Smart Locker x3", "Booting...");

  ensureWifi();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);
  ensureMqtt();
}

void loop() {
  ensureWifi();
  ensureMqtt();
  mqttClient.loop();

  unsigned long now = millis();
  if (mqttClient.connected() && now - lastHeartbeatSentAt >= 5000) {
    lastHeartbeatSentAt = now;
    publishDeviceStatus(true);
  }
}
