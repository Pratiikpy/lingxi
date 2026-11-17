/*
 * The handheld itself: what it shows and what its keys do. The platform (the browser page or the Cardputer's
 * firmware) gives it time, the wall clock in beats, whether its owner is holding it, and keys; it draws into the
 * platform's framebuffer. The pet's life goes only through the core (pet.c), and every step is written to the trip
 * log, which is all the game needs to bring the pet home.
 */
#ifndef LX_APP_H
#define LX_APP_H

#include "trip.h"
#include "draw.h"
#include "selftest.h"

typedef enum { LX_SCREEN_BOOT, LX_SCREEN_EMPTY, LX_SCREEN_HOME, LX_SCREEN_SNACKS, LX_SCREEN_PLAY, LX_SCREEN_BRAIN, LX_SCREEN_LEAVE, LX_SCREEN_HELP, LX_SCREEN_FAILED } lx_screen;

/* keys: lower-case letters and digits as themselves, and these */
#define LX_KEY_ESC 27
#define LX_KEY_ENTER 13
#define LX_KEY_SPACE 32
#define LX_KEY_DEL 8

/* where the handheld runs, for the words that say how to bring a pet home */
#define LX_PLATFORM_BROWSER 0
#define LX_PLATFORM_DEVICE 1

typedef struct {
  lx_arena arena;
  lx_trip trip;
  lx_log log;
  uint8_t scratch[LX_MAX_STATE];
  int ready, platform, lang, present;
  lx_selftest st;
  lx_screen screen;
  uint32_t nowMs, bootMs;
  int hasNote;
  lx_note note;
  uint32_t noteMs;
  int lastCare;
  uint32_t careMs;
  uint32_t playStartMs, playStopMs;
  int playStars, playDone;
  uint32_t beatsHere, caresHere;
  uint8_t lastOut;
  int openErr;
} lx_app;

void lx_app_init(lx_app *app, void *arenaMem, size_t arenaSize, uint8_t *logMem, uint32_t logCap, int platform, uint32_t nowMs);
/* take a pet: refused when the self-test failed or a pet is already here */
lx_err lx_app_open(lx_app *app, const uint8_t *packet, uint32_t len);
/* take the same pet back after a restart: the packet again, then its log replayed */
lx_err lx_app_resume(lx_app *app, const uint8_t *packet, uint32_t len, const uint8_t *ops, uint32_t opsLen);
/* time passes: the beats up to `wallBeat` are lived, with the owner there if `present` */
void lx_app_tick(lx_app *app, uint32_t nowMs, int32_t wallBeat, int present);
void lx_app_key(lx_app *app, int key);
void lx_app_draw(lx_app *app, lx_px *fb);
/* the packet that brings the pet home; the handheld keeps the pet until the game says it arrived */
uint32_t lx_app_close(lx_app *app, uint8_t *out, uint32_t cap);
/* the game has the pet: the handheld lets it go */
void lx_app_release(lx_app *app);

#endif
