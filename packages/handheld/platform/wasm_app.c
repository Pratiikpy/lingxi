/*
 * The handheld for the browser: the firmware's own app (core/app.c) with the page as its platform. The page gives
 * it time, the wall clock in beats, whether the tab is in view, and keys; it shows the 240x135 framebuffer as is.
 */
#include "../core/app.h"
#include "../core/link.h"

#define EXPORT(name) __attribute__((export_name(#name)))

static uint8_t arena_mem[512 * 1024];
static uint8_t log_mem[96 * 1024];
static uint8_t in_buf[256 * 1024];
static uint8_t out_buf[128 * 1024];
static lx_px fb[LX_W * LX_H];
static lx_app app;

void *memcpy(void *d, const void *s, size_t n) {
  lx_memcpy(d, s, n);
  return d;
}
void *memset(void *d, int v, size_t n) {
  lx_memset(d, v, n);
  return d;
}
int memcmp(const void *a, const void *b, size_t n) { return lx_memcmp(a, b, n); }

EXPORT(hh_in) uint8_t *hh_in(void) { return in_buf; }
EXPORT(hh_out) uint8_t *hh_out(void) { return out_buf; }
EXPORT(hh_fb) lx_px *hh_fb(void) { return fb; }

EXPORT(hh_init) int hh_init(uint32_t nowMs) {
  lx_app_init(&app, arena_mem, sizeof arena_mem, log_mem, sizeof log_mem, LX_PLATFORM_BROWSER, nowMs);
  return app.st.pass;
}
EXPORT(hh_open) int hh_open(uint32_t len) { return (int)lx_app_open(&app, in_buf, len); }
/* in_buf holds the packet, then the log */
EXPORT(hh_resume) int hh_resume(uint32_t packetLen, uint32_t logLen) {
  return (int)lx_app_resume(&app, in_buf, packetLen, in_buf + packetLen, logLen);
}
EXPORT(hh_tick) void hh_tick(uint32_t nowMs, int32_t wallBeat, int present) { lx_app_tick(&app, nowMs, wallBeat, present); }
EXPORT(hh_key) void hh_key(int key) { lx_app_key(&app, key); }
EXPORT(hh_draw) void hh_draw(void) { lx_app_draw(&app, fb); }
EXPORT(hh_close) uint32_t hh_close(void) { return lx_app_close(&app, out_buf, sizeof out_buf); }
EXPORT(hh_release) void hh_release(void) { lx_app_release(&app); }
/* the log so far, so the page can keep the trip across a reload */
EXPORT(hh_log) uint8_t *hh_log(void) { return app.log.buf; }
EXPORT(hh_log_len) uint32_t hh_log_len(void) { return app.log.len; }
EXPORT(hh_ready) int hh_ready(void) { return app.ready; }
EXPORT(hh_screen) int hh_screen(void) { return (int)app.screen; }
EXPORT(hh_beat) int32_t hh_beat(void) { return app.trip.pet.beat; }
EXPORT(hh_lang) int hh_lang(void) { return app.lang; }
EXPORT(hh_selftest) int hh_selftest(void) {
  const lx_selftest *s = &app.st;
  return s->hashOk[0] | s->hashOk[1] << 1 | s->hashOk[2] << 2 | s->loadOk[0] << 3 | s->loadOk[1] << 4 | s->loadOk[2] << 5 | s->pet1HashOk << 6 |
         s->pet1MemoryOk << 7 | s->pass << 8;
}
/* how much of the arena the loaded brain and the self-test left in use, for sizing the device's arena */
EXPORT(hh_arena_used) uint32_t hh_arena_used(void) { return (uint32_t)app.arena.used; }
/* for tests: shrink the log to what is used plus `room` bytes, to reach a full log without living for weeks */
EXPORT(hh_test_log_room) void hh_test_log_room(uint32_t room) { app.log.cap = app.log.len + room; }
EXPORT(hh_arena_peak) uint32_t hh_arena_peak(void) { return (uint32_t)app.arena.peak; }
EXPORT(hh_digest) void hh_digest(void) { lx_pet_digest(&app.trip.pet, out_buf); }

/*
 * The USB link, with the page standing in for the serial line: bytes the game would send go in through link_in,
 * and what the handheld would answer collects in link_reply. The browser handheld does not need the link; the tests
 * drive it here so the device's protocol is checked against the game's client without a device.
 */
static uint8_t link_in[64 * 1024];
static uint8_t link_reply[64 * 1024];
static uint32_t link_reply_len;
static uint8_t link_packet[16 * 1024];
static uint8_t link_out[48 * 1024];
static lx_link link;

static void link_write(void *ctx, const uint8_t *b, uint32_t n) {
  (void)ctx;
  for (uint32_t i = 0; i < n && link_reply_len < sizeof link_reply; i++) link_reply[link_reply_len++] = b[i];
}
EXPORT(hh_link_init) void hh_link_init(void) { lx_link_init(&link, link_packet, sizeof link_packet, link_out, sizeof link_out, link_write, 0); }
EXPORT(hh_link_in) uint8_t *hh_link_in(void) { return link_in; }
EXPORT(hh_link_feed) void hh_link_feed(uint32_t n, uint32_t nowMs) {
  for (uint32_t i = 0; i < n && i < sizeof link_in; i++) lx_link_byte(&link, &app, link_in[i], nowMs);
}
EXPORT(hh_link_reply) uint8_t *hh_link_reply(void) { return link_reply; }
/* how much reply is waiting; reading it empties it */
EXPORT(hh_link_reply_take) uint32_t hh_link_reply_take(void) {
  uint32_t n = link_reply_len;
  link_reply_len = 0;
  return n;
}
EXPORT(hh_link_wall_beat) int32_t hh_link_wall_beat(uint32_t nowMs) { return lx_link_wall_beat(&link, nowMs); }
EXPORT(hh_link_changed) int hh_link_changed(void) { return lx_link_take_changed(&link); }
