/*
 * The handheld's USB link (plan 4.14): how the game hands a Cardputer a pet and takes it back, over a serial line.
 *
 * Lines of ASCII, each ended by '\n'. The game asks, the handheld answers; packets travel as hex, decoded and encoded
 * a byte at a time, so neither side keeps a whole line in memory.
 *
 *   LX?            ->  LX! 1 <self-test 0|1> <pet aboard 0|1>
 *   LXPUT <hex>    ->  LXOK put            the trip packet; refused if a pet is aboard or it does not open
 *   LXGET          ->  LXBACK <hex>        the packet back; the pet stays aboard until the game takes it
 *   LXDONE         ->  LXOK done           the game replayed the trip and the pet is home: let it go
 *   LXDROP         ->  LXOK drop           the game called the pet back without its days: let it go
 *   LXTIME <beat>  ->  LXOK time           the wall clock in beats (minutes since 1970); the handheld has no clock
 *                                          of its own, so until the game tells it the time it lives nothing,
 *                                          and it never runs ahead of the time it was told; a later LXTIME
 *                                          corrects a clock that drifted
 *   anything else  ->  LXERR <code> <word>
 *
 * The game never trusts the handheld: what comes back is replayed in full before the pet is accepted, so the link
 * needs no checksum of its own beyond the one inside each packet.
 */
#ifndef LX_LINK_H
#define LX_LINK_H

#include "app.h"

#define LX_LINK_VERSION 1
#define LX_LINK_CMD_MAX 8

typedef enum {
  LX_LINK_OK = 0,
  LX_LINK_UNKNOWN = 20, /* a command this handheld does not know */
  LX_LINK_BAD_HEX = 21, /* a packet with a character that is not hex, or an odd count */
  LX_LINK_TOO_BIG = 22, /* a packet larger than the handheld's buffer */
  LX_LINK_BUSY = 23,    /* a pet is aboard already */
  LX_LINK_EMPTY = 24,   /* no pet aboard */
  LX_LINK_NO_TEST = 25, /* the self-test failed: this handheld takes no pets */
  LX_LINK_TOO_LONG = 26, /* the trip does not fit the reply buffer */
  LX_LINK_BAD_TIME = 27  /* a time that is not a number */
} lx_link_err;

/* the platform's way out: bytes for the serial line */
typedef void (*lx_link_write)(void *ctx, const uint8_t *bytes, uint32_t n);

typedef struct {
  char cmd[LX_LINK_CMD_MAX + 1];
  uint32_t cmdLen;
  int inArg;          /* past the space after the command */
  int overlong;       /* the command word ran past its length: the line is skipped to its end */
  uint8_t *packet;    /* where LXPUT's bytes are decoded */
  uint32_t cap, len;
  uint32_t held;      /* the length of the packet of the pet aboard, for the platform to keep */
  int half, nibble;   /* a hex byte half read */
  lx_link_err argErr; /* the first fault in the argument */
  uint8_t *out;       /* where LXGET closes the trip */
  uint32_t outCap;
  lx_link_write write;
  void *ctx;
  int changed;        /* a pet came aboard or left since the platform last asked */
  uint32_t number;    /* LXTIME's argument, read as decimal */
  int digits;
  int haveTime;       /* the game has told the time since the handheld started */
  int32_t timeBeat;   /* the beat it was told */
  uint32_t timeAtMs;  /* the handheld's own milliseconds when it was told */
} lx_link;

void lx_link_init(lx_link *l, uint8_t *packetBuf, uint32_t packetCap, uint8_t *outBuf, uint32_t outCap, lx_link_write write, void *ctx);
/* one byte from the serial line; answers are written as soon as a line ends */
void lx_link_byte(lx_link *l, lx_app *app, uint8_t b, uint32_t nowMs);
/* the wall clock in beats now, from the last time the game gave; -1 when it never has since the handheld started */
int32_t lx_link_wall_beat(const lx_link *l, uint32_t nowMs);
/* the platform keeps the trip (packet and log) when this says something changed, and on its own schedule */
int lx_link_take_changed(lx_link *l);

#endif
