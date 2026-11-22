/*
 * A pet's trip on the handheld.
 *
 * Out ("LXH1"): the game hands over the pet's state, its skill effects, a ration of snacks, what the screen needs
 * (name, line, stage, colour) and the brain: the netlist as read from X Layer, every circuit its REFs name, and the
 * keccak-256 of the netlist, which the handheld checks before running anything. The whole packet ends with its
 * own keccak-256, so a damaged transfer is refused rather than half-read.
 *
 * Back ("LXR1"): what happened, in order (live beats, beats away, each care) and the digest of the state it ended
 * in. The game replays that list from the state it kept, through the circuit on X Layer, and keeps the pet only if
 * its own digest is the same. The handheld is never trusted for the pet itself.
 *
 * All integers are little-endian.
 */
#ifndef LX_TRIP_H
#define LX_TRIP_H

#include "pet.h"

/* 2: the pet carries G3's enjoyment bar, last care beat and need tally */
#define LX_TRIP_VERSION 4
#define LX_MAX_PARTS 32
#define LX_MAX_SNACKS 4
#define LX_NAME_MAX 48

/* ops of the trip log */
#define LX_OP_LIVE 0x10  /* + u16 n: n live beats in a row, the owner watching */
#define LX_OP_AWAY 0x11  /* + u32 n: n beats with the owner away (the handheld asleep) */
#define LX_OP_CARE 0x20  /* + u8 kind + u8 arg: arg is the snack for feeding, the stars for play, else 0 */

#define LX_SNACK_NAME 31

typedef struct {
  uint8_t index; /* the game's food, by its place in the ration */
  uint16_t count;
  lx_food food;
  char id[16];
  char nameEn[LX_SNACK_NAME + 1], nameZh[LX_SNACK_NAME + 1];
} lx_snack;

typedef struct {
  lx_pet pet;
  uint8_t startDigest[32];
  int32_t bornBeat;
  uint8_t line, stage, form, colour, lang;
  char name[LX_NAME_MAX + 1];
  uint8_t nSnacks;
  lx_snack snacks[LX_MAX_SNACKS];
  uint8_t brainHash[32];
  uint8_t processor[20];
  uint64_t brainId;
  uint8_t nParts;
  lx_part parts[LX_MAX_PARTS];
  lx_circuit *brain;
} lx_trip;

/*
 * Read an outbound packet. The bytes must stay alive while the trip runs (circuits point into them).
 * Checks, in order: magic, version, the packet's own keccak, every length, the brain's keccak, then loads the
 * brain and checks its pin counts against the pet's state size.
 */
lx_err lx_trip_open(lx_trip *t, lx_arena *a, const uint8_t *bytes, uint32_t len);

/* The trip log, written as the trip goes. */
typedef struct {
  uint8_t *buf;
  uint32_t cap, len;
  uint32_t liveAt; /* where the open run of live beats has its count, 0 when none is open */
  uint16_t liveRun;
} lx_log;

void lx_log_init(lx_log *g, uint8_t *buf, uint32_t cap);
/* whether the log can take this op; asked before the pet is changed, so a step is never lived without being logged */
int lx_log_fits(const lx_log *g, uint8_t op);
int lx_log_live(lx_log *g);
int lx_log_away(lx_log *g, uint32_t n);
int lx_log_care(lx_log *g, uint8_t kind, uint8_t arg);

/* The packet back: magic, version, the start digest, the ops, the end digest, its own keccak. */
uint32_t lx_trip_close(const lx_trip *t, const lx_log *g, uint8_t *out, uint32_t cap);

#endif
