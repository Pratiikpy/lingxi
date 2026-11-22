/*
 * The pet's life, beat by beat, as packages/game/src/sim.ts lives it: the same integer arithmetic in the same
 * order, so a day on the handheld and the same day replayed by the game end in the same bits. Tests hold the two
 * to that (packages/handheld/test).
 *
 * The game's skills enter as numbers the game computed when the pet set out (`lx_effects`); they cannot change
 * while the pet is away, because spending skill points happens at home.
 */
#ifndef LX_PET_H
#define LX_PET_H

#include "tap02.h"

#define LX_SUB 60
#define LX_METER_MAX 1000
#define LX_BEAT_MS 60000
#define LX_HIBERNATE_AFTER (48 * 60)
#define LX_MAX_CATCH_UP (3 * 24 * 60)
#define LX_SICK_AFTER (24 * 60)
/* G5 (packages/game pet.ts): needs stop at the floor until the pet has gone FLOOR_HOLDS beats without care, then fall
   at an eighth of the rate; an absence decays in full up to DECAY_SPAN beats, the brain thinking only its last
   MAX_CATCH_UP */
#define LX_NEED_FLOOR 240
#define LX_FLOOR_HOLDS (4 * 24 * 60)
#define LX_LOW_DECAY_DIVISOR 8
#define LX_DECAY_SPAN (30 * 24 * 60)
#define LX_KINSHIP_EVERY (12 * 60)
#define LX_KINSHIP_DECAY (24 * 60)
#define LX_KINSHIP_MAX 255
#define LX_TRAIT_MAX 15
#define LX_MAX_STATE 512
#define LX_MISSED_KEPT 8

/* meters, in the game's order of the Meters type */
enum { LX_FOOD = 0, LX_JOY = 1, LX_ENERGY = 2, LX_CLEAN = 3 };
/* care-miss kinds, as the digest encodes them */
enum { LX_MISS_FOOD = 0, LX_MISS_JOY = 1, LX_MISS_CLEAN = 2, LX_MISS_ENERGY = 3, LX_MISS_SICK = 4 };
/* the brain's action pin values (packages/game ACTION) */
enum { LX_A_NONE = 0, LX_A_FEED = 1, LX_A_PLAY = 2, LX_A_CLEAN = 3, LX_A_LIGHTS = 4, LX_A_PET = 5, LX_A_MEDICINE = 6, LX_A_TALK = 7 };
/* the brain's wants */
enum { LX_W_IDLE = 0, LX_W_EAT = 1, LX_W_PLAY = 2, LX_W_SLEEP = 3, LX_W_EXPLORE = 4, LX_W_SULK = 5, LX_W_CUDDLE = 6, LX_W_SHARE = 7 };

/* care the owner can give on the handheld; the codes are the op codes of the trip log */
enum { LX_C_FEED = 1, LX_C_PLAY = 2, LX_C_CLEAN = 3, LX_C_LIGHTS = 4, LX_C_WAKE = 5, LX_C_PET = 6, LX_C_MEDICINE = 7, LX_C_TALK = 8 };

/* what the owner sees happen, as packages/game CareResult note */
typedef enum {
  LX_N_ATE, LX_N_OVERFED, LX_N_WOKE, LX_N_PLAYED, LX_N_TOO_TIRED, LX_N_TOO_SICK, LX_N_CLEANED, LX_N_SLEEPING,
  LX_N_AWAKE, LX_N_PETTED, LX_N_HEALED, LX_N_NOT_SICK, LX_N_LISTENED, LX_N_HIBERNATION_ENDED
} lx_note;

typedef struct {
  /* decayLeft per meter (per mille of the base decay, at least 400) */
  uint16_t decayLeft[4];
  int16_t sleepGain, sickGrace, hibernateGrace, foodItem, joyItem, bathJoy, kinshipKeep, kinshipSooner, xpGain,
      traitGrowth;
} lx_effects;

/* a snack as packages/game ItemEffect: visible units */
typedef struct {
  int16_t food, joy, energy, xp;
  int8_t diet; /* -1 none, else 0 sweet 1 fruit 2 savory 3 grain */
} lx_food;

typedef struct {
  int32_t beat;
  int32_t tzOffsetMin;
  int32_t meters[4];
  uint8_t asleep, hibernating, sick;
  int32_t starvingBeats, dirtyBeats, mistakes;
  /* G5: beats since the owner last cared, and beats spent with a need at zero (they do not count toward growing up) */
  int32_t uncaredBeats, stalledBeats;
  uint8_t nMissed;
  uint8_t missedKind[LX_MISSED_KEPT];
  int32_t missedBeat[LX_MISSED_KEPT];
  int32_t kinship;
  uint8_t hasKinBeat;
  int32_t kinBeat;
  uint32_t nBrain;
  uint8_t brain[LX_MAX_STATE];
  int32_t traits[7];
  int32_t xp, xpCarry, traitCarry;
  int32_t counts[5]; /* feed, play, clean, pet, lessons */
  int32_t diet[4];
  /* G3: the enjoyment bar (0..100), the beat of the last care thought about, care that answered a need */
  int32_t enjoy;
  uint8_t hasCareBeat;
  int32_t careBeat;
  uint8_t hasNeeds;
  int32_t needs[4]; /* feed, play, clean, pet */
  uint8_t logHash[32];
  uint32_t logLength; /* words logged since the pet set out */
  uint8_t hasLogBeat;
  int32_t logBeat;
  uint8_t lastWant, lastMood, lastNudge;
  uint16_t lastWord;
  lx_effects fx;
} lx_pet;

uint16_t lx_input_word(const lx_pet *p, int32_t beat, int action, int event, int owner);
int lx_local_hour(const lx_pet *p, int32_t beat);
int lx_time_of_day(int hour);
int32_t lx_kinship_now(const lx_pet *p, int32_t beat);

/* the game's liveBeat for one beat: the owner is watching and nothing was done */
void lx_live(lx_pet *p, lx_circuit *brain, uint8_t *scratch);
/* the game's catchUp to `beat`: the owner away, beats replayed (at most three days of them) */
void lx_away_to(lx_pet *p, lx_circuit *brain, uint8_t *scratch, int32_t beat);
/* the game's care, inside the current beat; `food` for feeding, `stars` for play */
lx_note lx_care(lx_pet *p, lx_circuit *brain, uint8_t *scratch, int kind, const lx_food *food, int stars);

/* A fixed encoding of every field of the pet's life, hashed: the game computes the same (packages/handheld). */
void lx_pet_digest(const lx_pet *p, uint8_t out[32]);

#endif
