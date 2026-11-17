#include "pet.h"

/* visible units lost per hour, which is also internal units per beat (packages/game DECAY_PER_HOUR) */
static const int32_t DECAY[4] = {45, 30, 28, 18}; /* food, joy, energy, clean */
static const int32_t SLEEP_GAIN_PER_HOUR = 90;

static int32_t clamp_meter(int32_t v) { return v < 0 ? 0 : v > LX_METER_MAX * LX_SUB ? LX_METER_MAX * LX_SUB : v; }
static int32_t visible(int32_t internal) { return internal / LX_SUB; }
static int32_t add_visible(int32_t internal, int32_t v) { return clamp_meter(internal + v * LX_SUB); }
static int32_t boosted(int32_t value, int32_t pct) { return (int32_t)(((int64_t)value * (100 + pct)) / 100); }
/* a good thing made better by a percent skill; a bad one is left as it is */
static int32_t more(int32_t amount, int32_t pct) { return amount > 0 ? boosted(amount, pct) : amount; }
static int32_t imin(int32_t a, int32_t b) { return a < b ? a : b; }
static int32_t imax(int32_t a, int32_t b) { return a > b ? a : b; }
static int32_t floor_div(int32_t a, int32_t b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }

static int bucket(int32_t v) { return v < 250 ? 0 : v < 500 ? 1 : v < 750 ? 2 : 3; }

int lx_time_of_day(int hour) {
  if (hour < 6) return 0;
  if (hour < 11) return 1;
  if (hour < 17) return 2;
  if (hour < 21) return 3;
  return 0;
}

int lx_local_hour(const lx_pet *p, int32_t beat) {
  int32_t h = floor_div(beat + p->tzOffsetMin, 60) % 24;
  return h < 0 ? h + 24 : h;
}

uint16_t lx_input_word(const lx_pet *p, int32_t beat, int action, int event, int owner) {
  uint32_t w = 0;
  w |= (uint32_t)(3 - bucket(visible(p->meters[LX_FOOD])));
  w |= (uint32_t)bucket(visible(p->meters[LX_JOY])) << 2;
  w |= (uint32_t)bucket(visible(p->meters[LX_ENERGY])) << 4;
  w |= (uint32_t)bucket(visible(p->meters[LX_CLEAN])) << 6;
  w |= (uint32_t)lx_time_of_day(lx_local_hour(p, beat)) << 8;
  w |= (uint32_t)(action & 7) << 10;
  w |= (uint32_t)(event & 3) << 13;
  w |= (uint32_t)(owner ? 1 : 0) << 15;
  return (uint16_t)w;
}

int32_t lx_kinship_now(const lx_pet *p, int32_t beat) {
  if (!p->hasKinBeat) return p->kinship;
  int32_t every = boosted(LX_KINSHIP_DECAY, p->fx.kinshipKeep);
  return imax(0, p->kinship - imax(0, beat - p->kinBeat) / every);
}

static void gain_xp(lx_pet *p, int32_t n) {
  if (n <= 0) return;
  int32_t hundredths = p->xpCarry + n * (100 + p->fx.xpGain);
  p->xp = imin(0xffff, p->xp + hundredths / 100);
  p->xpCarry = hundredths % 100;
}

/* a care mistake: counted, the latest few kept for the screen */
static void miss(lx_pet *p, int kind, int32_t beat) {
  p->mistakes = imin(63, p->mistakes + 1);
  if (p->nMissed == LX_MISSED_KEPT) {
    for (int i = 1; i < LX_MISSED_KEPT; i++) {
      p->missedKind[i - 1] = p->missedKind[i];
      p->missedBeat[i - 1] = p->missedBeat[i];
    }
    p->nMissed--;
  }
  p->missedKind[p->nMissed] = (uint8_t)kind;
  p->missedBeat[p->nMissed] = beat;
  p->nMissed++;
}

static int32_t less(const lx_pet *p, int m) { return (DECAY[m] * (int32_t)p->fx.decayLeft[m]) / 1000; }

static void decay(lx_pet *p, int32_t beat) {
  if (p->hibernating) return;
  int32_t was[4];
  for (int i = 0; i < 4; i++) was[i] = p->meters[i];
  int32_t ill = p->sick ? 2 : 1;
  p->meters[LX_FOOD] = clamp_meter(p->meters[LX_FOOD] - less(p, LX_FOOD));
  p->meters[LX_JOY] = clamp_meter(p->meters[LX_JOY] - less(p, LX_JOY) * ill);
  p->meters[LX_CLEAN] = clamp_meter(p->meters[LX_CLEAN] - less(p, LX_CLEAN));
  p->meters[LX_ENERGY] = clamp_meter(p->meters[LX_ENERGY] +
                                     (p->asleep ? boosted(SLEEP_GAIN_PER_HOUR, p->fx.sleepGain) : -less(p, LX_ENERGY) * ill));
  /* in the game's order: food, joy, clean, energy */
  static const int order[4] = {LX_FOOD, LX_JOY, LX_CLEAN, LX_ENERGY};
  static const int kind[4] = {LX_MISS_FOOD, LX_MISS_JOY, LX_MISS_CLEAN, LX_MISS_ENERGY};
  for (int i = 0; i < 4; i++)
    if (was[order[i]] > 0 && p->meters[order[i]] == 0) miss(p, kind[i], beat);
  /* neglect: an empty food bowl or a filthy pet, six hours running, makes it ill */
  p->dirtyBeats = (p->meters[LX_CLEAN] == 0 || p->meters[LX_FOOD] == 0) ? p->dirtyBeats + 1 : 0;
  if (!p->sick && p->dirtyBeats >= boosted(LX_SICK_AFTER, p->fx.sickGrace)) {
    p->sick = 1;
    miss(p, LX_MISS_SICK, beat);
  }
  p->starvingBeats = p->meters[LX_FOOD] == 0 ? p->starvingBeats + 1 : 0;
  if (p->starvingBeats >= boosted(LX_HIBERNATE_AFTER, p->fx.hibernateGrace)) {
    p->hibernating = 1;
    p->asleep = 1;
  }
}

/* run the brain on one beat and let its answer move the pet */
static void think(lx_pet *p, lx_circuit *brain, uint8_t *scratch, int32_t beat, int action, int event, int owner) {
  uint16_t word = lx_input_word(p, beat, action, event, owner);
  uint32_t out = lx_step_word(brain, p->brain, scratch, word);
  int want = out & 7, mood = (out >> 3) & 3, nudge = (out >> 5) & 7;
  p->lastWant = (uint8_t)want;
  p->lastMood = (uint8_t)mood;
  p->lastNudge = (uint8_t)nudge;
  p->lastWord = word;
  lx_chain_log(p->logHash, word);
  p->logLength++;
  p->hasLogBeat = 1;
  p->logBeat = beat;

  int32_t energy = visible(p->meters[LX_ENERGY]);
  if (!p->asleep && want == LX_W_SLEEP && energy < 600) p->asleep = 1;
  else if (p->asleep && !p->hibernating && energy >= 950 && lx_time_of_day(lx_local_hour(p, beat)) != 0) p->asleep = 0;
  if (!p->asleep) {
    if (want == LX_W_SULK) p->meters[LX_JOY] = add_visible(p->meters[LX_JOY], -2);
    if (want == LX_W_CUDDLE && owner) p->meters[LX_JOY] = add_visible(p->meters[LX_JOY], 3);
    if (want == LX_W_PLAY && owner) {
      p->meters[LX_JOY] = add_visible(p->meters[LX_JOY], 2);
      p->meters[LX_ENERGY] = add_visible(p->meters[LX_ENERGY], -1);
    }
    if (want == LX_W_EXPLORE) {
      p->meters[LX_JOY] = add_visible(p->meters[LX_JOY], 1);
      p->meters[LX_CLEAN] = add_visible(p->meters[LX_CLEAN], -2);
    }
  }
  if (nudge > 0 && (action != LX_A_NONE || event != 0)) {
    int t = nudge - 1;
    int32_t grow = p->traitCarry + 100 + p->fx.traitGrowth;
    p->traits[t] = imin(LX_TRAIT_MAX, p->traits[t] + grow / 100);
    if (p->fx.traitGrowth) p->traitCarry = grow % 100;
  }
  if (owner && action != LX_A_NONE) gain_xp(p, 1);
}

void lx_away_to(lx_pet *p, lx_circuit *brain, uint8_t *scratch, int32_t target) {
  if (target <= p->beat) return;
  int32_t gap = target - p->beat;
  int32_t b = p->beat + imax(0, gap - LX_MAX_CATCH_UP);
  while (b < target) {
    b++;
    decay(p, b);
    if (!p->hibernating) think(p, brain, scratch, b, LX_A_NONE, 0, 0);
  }
  p->beat = target;
}

void lx_live(lx_pet *p, lx_circuit *brain, uint8_t *scratch) {
  int32_t target = p->beat + 1;
  p->beat = target;
  decay(p, target);
  if (!p->hibernating) think(p, brain, scratch, target, LX_A_NONE, 0, 1);
}

lx_note lx_care(lx_pet *p, lx_circuit *brain, uint8_t *scratch, int kind, const lx_food *food, int stars) {
  int action = LX_A_NONE;
  lx_note note = LX_N_LISTENED;
  if (p->hibernating && (kind == LX_C_FEED || kind == LX_C_PET || kind == LX_C_WAKE)) {
    p->hibernating = 0;
    p->asleep = 0;
    p->starvingBeats = 0;
    p->meters[LX_FOOD] = add_visible(p->meters[LX_FOOD], 200);
    p->meters[LX_JOY] = clamp_meter(p->meters[LX_JOY] - 100 * LX_SUB);
    return LX_N_HIBERNATION_ENDED;
  }
  switch (kind) {
    case LX_C_FEED: {
      int wasFull = visible(p->meters[LX_FOOD]) >= 900;
      p->meters[LX_FOOD] = add_visible(p->meters[LX_FOOD], more(food->food, p->fx.foodItem));
      p->meters[LX_JOY] = add_visible(p->meters[LX_JOY], wasFull ? -40 : more(food->joy, p->fx.joyItem));
      if (food->energy) p->meters[LX_ENERGY] = add_visible(p->meters[LX_ENERGY], food->energy);
      if (food->xp) gain_xp(p, food->xp);
      if (food->diet >= 0 && food->diet < 4) p->diet[food->diet] = imin(63, p->diet[food->diet] + 1);
      p->counts[0] = imin(255, p->counts[0] + 1);
      if (p->asleep) {
        p->asleep = 0;
        note = LX_N_WOKE;
      } else note = wasFull ? LX_N_OVERFED : LX_N_ATE;
      action = LX_A_FEED;
      break;
    }
    case LX_C_PLAY: {
      action = LX_A_PLAY;
      if (p->sick) {
        note = LX_N_TOO_SICK;
        break;
      }
      if (visible(p->meters[LX_ENERGY]) < 120) {
        note = LX_N_TOO_TIRED;
        break;
      }
      p->asleep = 0;
      int s = stars < 0 ? 0 : stars > 3 ? 3 : stars;
      p->meters[LX_JOY] = add_visible(p->meters[LX_JOY], more(220 + 60 * s, p->fx.joyItem));
      p->meters[LX_ENERGY] = add_visible(p->meters[LX_ENERGY], -80);
      p->meters[LX_FOOD] = add_visible(p->meters[LX_FOOD], -40);
      gain_xp(p, 2 * s);
      p->counts[1] = imin(255, p->counts[1] + 1);
      note = LX_N_PLAYED;
      break;
    }
    case LX_C_CLEAN:
      p->meters[LX_CLEAN] = LX_METER_MAX * LX_SUB;
      if (p->fx.bathJoy) p->meters[LX_JOY] = add_visible(p->meters[LX_JOY], p->fx.bathJoy);
      p->counts[2] = imin(255, p->counts[2] + 1);
      note = LX_N_CLEANED;
      action = LX_A_CLEAN;
      break;
    case LX_C_LIGHTS:
      p->asleep = 1;
      note = LX_N_SLEEPING;
      action = LX_A_LIGHTS;
      break;
    case LX_C_WAKE:
      p->asleep = 0;
      note = LX_N_AWAKE;
      break;
    case LX_C_PET:
      p->meters[LX_JOY] = add_visible(p->meters[LX_JOY], 40);
      p->counts[3] = imin(255, p->counts[3] + 1);
      if (!p->hasKinBeat || p->beat - p->kinBeat >= imax(360, LX_KINSHIP_EVERY - p->fx.kinshipSooner)) {
        p->kinship = imin(LX_KINSHIP_MAX, lx_kinship_now(p, p->beat) + 1);
        p->hasKinBeat = 1;
        p->kinBeat = p->beat;
      }
      note = LX_N_PETTED;
      action = LX_A_PET;
      break;
    case LX_C_MEDICINE:
      if (p->sick) {
        p->sick = 0;
        p->dirtyBeats = 0;
        p->meters[LX_ENERGY] = add_visible(p->meters[LX_ENERGY], 100);
        note = LX_N_HEALED;
      } else note = LX_N_NOT_SICK;
      action = LX_A_MEDICINE;
      break;
    case LX_C_TALK:
    default:
      note = LX_N_LISTENED;
      action = LX_A_TALK;
      break;
  }
  think(p, brain, scratch, p->beat, action, 0, 1);
  return note;
}

/* little-endian fields, in a fixed order; the game's digest writes the same bytes (packages/handheld/src) */
static void put32(lx_keccak *k, int32_t v) {
  uint8_t b[4] = {(uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24)};
  lx_keccak_update(k, b, 4);
}
static void put8(lx_keccak *k, uint8_t v) { lx_keccak_update(k, &v, 1); }

void lx_pet_digest(const lx_pet *p, uint8_t out[32]) {
  lx_keccak k;
  lx_keccak_init(&k);
  lx_keccak_update(&k, (const uint8_t *)"LXPET1", 6);
  put32(&k, p->beat);
  for (int i = 0; i < 4; i++) put32(&k, p->meters[i]);
  put8(&k, p->asleep);
  put8(&k, p->hibernating);
  put8(&k, p->sick);
  put32(&k, p->starvingBeats);
  put32(&k, p->dirtyBeats);
  put32(&k, p->mistakes);
  put8(&k, p->nMissed);
  for (int i = 0; i < p->nMissed; i++) {
    put8(&k, p->missedKind[i]);
    put32(&k, p->missedBeat[i]);
  }
  put32(&k, p->kinship);
  put8(&k, p->hasKinBeat);
  put32(&k, p->hasKinBeat ? p->kinBeat : 0);
  put32(&k, (int32_t)p->nBrain);
  for (uint32_t i = 0; i < p->nBrain; i++) put8(&k, p->brain[i]);
  for (int i = 0; i < 7; i++) put32(&k, p->traits[i]);
  put32(&k, p->xp);
  put32(&k, p->xpCarry);
  put32(&k, p->traitCarry);
  for (int i = 0; i < 5; i++) put32(&k, p->counts[i]);
  for (int i = 0; i < 4; i++) put32(&k, p->diet[i]);
  lx_keccak_update(&k, p->logHash, 32);
  put32(&k, (int32_t)p->logLength);
  put8(&k, p->hasLogBeat);
  put32(&k, p->hasLogBeat ? p->logBeat : 0);
  put8(&k, p->lastWant);
  put8(&k, p->lastMood);
  put8(&k, p->lastNudge);
  put32(&k, p->lastWord);
  lx_keccak_final(&k, out);
}
