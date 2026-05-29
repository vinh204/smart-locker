/*
 * Smart Locker - ESP32 Edge Device
 * WebServer /update -> LCD I2C + Relay (non-blocking auto-lock)
 */
#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// --- Cấu hình WiFi (sửa theo mạng thực tế) ---
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// --- Phần cứng ---
#define RELAY_PIN 26
#define SDA_PIN 21
#define SCL_PIN 22
#define LCD_ADDR 0x27
#define LCD_COLS 16
#define LCD_ROWS 2

const unsigned long DISPLAY_DURATION = 3000;  // ms - tự động khóa sau 3 giây

WebServer server(80);
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);

bool isDisplaying = false;
unsigned long displayStartTime = 0;

void showLines(const String& line1, const String& line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, LCD_COLS));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, LCD_COLS));
}

void lockLocker() {
  digitalWrite(RELAY_PIN, LOW);   // LOW = khóa (tùy module relay)
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("He thong san sang");
  isDisplaying = false;
}

void unlockLocker(const String& line1, const String& line2) {
  digitalWrite(RELAY_PIN, HIGH);  // HIGH = mở khóa
  showLines(line1, line2);
  isDisplaying = true;
  displayStartTime = millis();
}

void handleUpdate() {
  String line1 = server.hasArg("line1") ? server.arg("line1") : "Smart Locker";
  String line2 = server.hasArg("line2") ? server.arg("line2") : "Xac thuc OK";
  unlockLocker(line1, line2);
  server.send(200, "text/plain", "OK");
}

void handleRoot() {
  server.send(200, "text/plain", "ESP32 Smart Locker - GET /update?line1=&line2=");
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);
  lcd.init();
  lcd.backlight();
  showLines("Dang ket noi...", "");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  showLines("IP:", WiFi.localIP().toString());

  server.on("/", handleRoot);
  server.on("/update", handleUpdate);
  server.begin();
}

void loop() {
  server.handleClient();

  if (isDisplaying && (millis() - displayStartTime >= DISPLAY_DURATION)) {
    lockLocker();
  }
}
