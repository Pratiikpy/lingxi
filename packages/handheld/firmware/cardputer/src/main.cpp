/*
 * Lingxi on an M5Stack Cardputer ADV (plan 4.14): the platform layer around the shared C core.
 *
 * The core (../../core) does everything a pet needs: its life, its brain, the screen, the trip log, the USB link.
 * This file only hands it time and keys, pushes its framebuffer to the display, reads and writes the serial line,
 * and keeps the trip in flash so a pet survives the battery running out.
 *
 * The handheld has no clock of its own. The game tells it the time over USB (LXTIME) whenever it is plugged in;
 * until then after a restart it lives nothing, and it never runs ahead of the time it was told, because the game
 * refuses a trip that ends in the future.
 */
extern "C" {
#include "app.h"
#include "link.h"
}

#ifdef LX_SELFTEST_ONLY
/* The emulator build: the core's boot self-test and the link's hello on the real chip's compiler and memory, printed
   on UART0. No screen, keys or flash are touched, so it runs where no device is attached. */
#include <Arduino.h>

static uint8_t arenaMem[64 * 1024];
static uint8_t logMem[4 * 1024];
static uint8_t packetMem[1024];
static uint8_t outMem[1024];
static lx_app app;
static lx_link usbLink;

static void serialWrite(void *, const uint8_t *bytes, uint32_t n) { Serial.write(bytes, n); }

void setup() {
  Serial.begin(115200);
  const uint32_t t0 = millis();
  lx_app_init(&app, arenaMem, sizeof arenaMem, logMem, sizeof logMem, LX_PLATFORM_DEVICE, t0);
  const lx_selftest &s = app.st;
  Serial.printf("selftest: starter hashes %d%d%d, loads %d%d%d, pet #1 log hash %d, memory %d, pass %d, %lu ms, arena peak %u\n",
                s.hashOk[0], s.hashOk[1], s.hashOk[2], s.loadOk[0], s.loadOk[1], s.loadOk[2], s.pet1HashOk, s.pet1MemoryOk, s.pass,
                (unsigned long)(millis() - t0), (unsigned)app.arena.peak);
  lx_link_init(&usbLink, packetMem, sizeof packetMem, outMem, sizeof outMem, serialWrite, nullptr);
  for (const char *c = "LX?\nLXGET\n"; *c; c++) lx_link_byte(&usbLink, &app, (uint8_t)*c, millis());
  Serial.println("selftest: done");
}

void loop() { delay(1000); }

#else
#include <M5Cardputer.h>
#include <LittleFS.h>
/* sized from scripts/measure-sizes.ts: the largest packet a pet can bring is 7.8 KB and the arena's peak is 32.9 KB
   (the self-test's 25.8 KB, then the largest brain), so both have twice that. The log holds thousands of cares and
   any number of hours put down; when it is full the pet stops and asks to go home (core/app.c). The packet back is
   the log plus 109 bytes. */
static uint8_t arenaMem[64 * 1024];
static uint8_t logMem[32 * 1024];
static uint8_t packetMem[16 * 1024];
static uint8_t outMem[sizeof logMem + 1024];
static lx_px fb[LX_W * LX_H];
static lx_app app;
static lx_link usbLink;

static const char *TRIP_FILE = "/trip.bin";
static const char *LOG_FILE = "/log.bin";
/* with no key for this long the handheld is put down: the screen dims and the time passes as time away */
static const uint32_t PUT_DOWN_MS = 3u * 60u * 1000u;
static const uint32_t KEEP_EVERY_MS = 60u * 1000u;

static uint32_t lastKeyMs;
static uint32_t lastKeepMs;
static uint32_t keptLogLen;
static uint32_t packetLen;
static bool dimmed;

static void serialWrite(void *, const uint8_t *bytes, uint32_t n) { Serial.write(bytes, n); }

static bool writeFile(const char *path, const uint8_t *bytes, size_t n) {
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  const bool ok = f.write(bytes, n) == n;
  f.close();
  return ok;
}

static size_t readFile(const char *path, uint8_t *into, size_t cap) {
  File f = LittleFS.open(path, "r");
  if (!f) return 0;
  const size_t n = f.size() <= cap ? f.read(into, f.size()) : 0;
  f.close();
  return n;
}

/* the trip is kept as its packet and its log: they replay to the same pet after a restart */
static void keep(bool packetToo) {
  if (!app.ready) {
    LittleFS.remove(TRIP_FILE);
    LittleFS.remove(LOG_FILE);
    keptLogLen = 0;
    return;
  }
  if (packetToo) {
    packetLen = usbLink.held;
    writeFile(TRIP_FILE, packetMem, packetLen);
  }
  if (app.log.len != keptLogLen) {
    writeFile(LOG_FILE, app.log.buf, app.log.len);
    keptLogLen = app.log.len;
  }
}

static void resume() {
  /* the packet sits in packetMem; the log is read after it into outMem, which is free until a trip goes home */
  packetLen = readFile(TRIP_FILE, packetMem, sizeof packetMem);
  if (!packetLen) return;
  const size_t logLen = readFile(LOG_FILE, outMem, sizeof outMem);
  const lx_err e = lx_app_resume(&app, packetMem, packetLen, outMem, logLen);
  if (e == LX_OK) {
    keptLogLen = app.log.len;
    Serial.printf("boot: resumed %s, %u log bytes\n", app.trip.name, (unsigned)logLen);
  } else {
    Serial.printf("boot: the kept trip did not resume (%d)\n", (int)e);
  }
}

static int keyOf(const Keyboard_Class::KeysState &k) {
  if (k.enter) return LX_KEY_ENTER;
  if (k.del) return LX_KEY_DEL;
  if (k.word.empty()) return 0;
  const char c = k.word.front();
  if (c == '`') return LX_KEY_ESC;
  return (c >= 'A' && c <= 'Z') ? c - 'A' + 'a' : c;
}

void setup() {
  auto cfg = M5.config();
  M5Cardputer.begin(cfg, true);
  M5Cardputer.Display.setRotation(1);
  M5Cardputer.Display.setBrightness(128);
  Serial.begin(115200);
  if (!LittleFS.begin(true)) Serial.println("boot: flash storage did not mount; trips will not survive a restart");
  lx_app_init(&app, arenaMem, sizeof arenaMem, logMem, sizeof logMem, LX_PLATFORM_DEVICE, millis());
  Serial.printf("boot: self-test %s\n", app.st.pass ? "passed" : "FAILED");
  lx_link_init(&usbLink, packetMem, sizeof packetMem, outMem, sizeof outMem, serialWrite, nullptr);
  if (app.st.pass) resume();
  lastKeyMs = lastKeepMs = millis();
}

void loop() {
  M5Cardputer.update();
  const uint32_t now = millis();

  while (Serial.available()) lx_link_byte(&usbLink, &app, (uint8_t)Serial.read(), now);
  if (lx_link_take_changed(&usbLink)) keep(true);

  if (M5Cardputer.Keyboard.isChange() && M5Cardputer.Keyboard.isPressed()) {
    const int key = keyOf(M5Cardputer.Keyboard.keysState());
    lastKeyMs = now;
    if (dimmed) {
      /* the first key only wakes the screen */
      dimmed = false;
      M5Cardputer.Display.setBrightness(128);
    } else if (key) {
      lx_app_key(&app, key);
    }
  }

  const bool present = now - lastKeyMs < PUT_DOWN_MS;
  if (!present && !dimmed) {
    dimmed = true;
    M5Cardputer.Display.setBrightness(8);
  }
  /* without a time from the game since starting, the pet's own beat stands in: nothing is lived */
  const int32_t wall = lx_link_wall_beat(&usbLink, now);
  lx_app_tick(&app, now, wall >= 0 ? wall : app.trip.pet.beat, present ? 1 : 0);

  if (now - lastKeepMs > KEEP_EVERY_MS) {
    keep(false);
    lastKeepMs = now;
  }

  lx_app_draw(&app, fb);
  /* lx_px is RGB565 in the CPU's byte order, which is M5GFX's rgb565_t */
  M5Cardputer.Display.pushImage(0, 0, LX_W, LX_H, reinterpret_cast<const lgfx::rgb565_t *>(fb));
  delay(dimmed ? 200 : 33);
}

#endif
