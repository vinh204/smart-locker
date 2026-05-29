/**
 * Smart Locker — firmware cho Wokwi
 * WiFi: Wokwi-GUEST | API: GET /open?locker=1&line1=&line2=
 */
#include <WiFi.h>
#include <WebServer.h>

// WiFi mô phỏng Wokwi (không dùng mạng nhà)
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// LED mô phỏng relay mở tủ (tủ 1–3)
const int LOCKER_PINS[] = {25, 26, 27};
const int LOCKER_COUNT = 3;

const unsigned long UNLOCK_MS = 3000;

WebServer server(80);
bool lockerOpen[LOCKER_COUNT] = {false, false, false};
unsigned long unlockUntil[LOCKER_COUNT] = {0, 0, 0};

void lockAll() {
  for (int i = 0; i < LOCKER_COUNT; i++) {
    digitalWrite(LOCKER_PINS[i], LOW);
    lockerOpen[i] = false;
  }
  Serial.println("Da khoa tat ca cac tu");
}

void unlockLocker(int idx, const String& line1, const String& line2) {
  if (idx < 0 || idx >= LOCKER_COUNT) return;
  digitalWrite(LOCKER_PINS[idx], HIGH);
  lockerOpen[idx] = true;
  unlockUntil[idx] = millis() + UNLOCK_MS;
  Serial.print("Mo tu ");
  Serial.print(idx + 1);
  Serial.print(" | ");
  Serial.println(line1);
}

void handleRoot() {
  server.send(
    200,
    "text/plain",
    "Tu do thong minh (Wokwi)\nGET /open?locker=1&line1=Gui&line2=do\n"
  );
}

void handleOpen() {
  if (!server.hasArg("locker")) {
    server.send(400, "text/plain", "Thieu tham so locker=1..3");
    return;
  }
  int locker = server.arg("locker").toInt();
  if (locker < 1 || locker > LOCKER_COUNT) {
    server.send(400, "text/plain", "So tu phai tu 1 den 3");
    return;
  }
  String line1 = server.hasArg("line1") ? server.arg("line1") : "Mo tu";
  String line2 = server.hasArg("line2") ? server.arg("line2") : "Thanh cong";
  unlockLocker(locker - 1, line1, line2);
  server.send(200, "text/plain", "Da mo tu");
}

// Tương thích code Python cũ: /update?line1=&line2=
void handleUpdate() {
  String line1 = server.hasArg("line1") ? server.arg("line1") : "Tu do thong minh";
  String line2 = server.hasArg("line2") ? server.arg("line2") : "San sang";
  unlockLocker(0, line1, line2);
  server.send(200, "text/plain", "Da cap nhat");
}

void setup() {
  Serial.begin(115200);
  delay(100);

  for (int i = 0; i < LOCKER_COUNT; i++) {
    pinMode(LOCKER_PINS[i], OUTPUT);
    digitalWrite(LOCKER_PINS[i], LOW);
  }

  Serial.println("Dang ket noi WiFi Wokwi-GUEST...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  server.on("/", handleRoot);
  server.on("/open", handleOpen);
  server.on("/update", handleUpdate);
  server.begin();
  Serial.println("May chu HTTP da chay tren cong 80");
}

void loop() {
  server.handleClient();

  unsigned long now = millis();
  for (int i = 0; i < LOCKER_COUNT; i++) {
    if (lockerOpen[i] && now >= unlockUntil[i]) {
      digitalWrite(LOCKER_PINS[i], LOW);
      lockerOpen[i] = false;
      Serial.print("Tu dong khoa tu ");
      Serial.println(i + 1);
    }
  }
}
