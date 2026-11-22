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

/* G3: the enjoyment bar, as packages/game sim.ts keeps it */
#define LX_ENJOY_MAX 100
#define LX_ENJOY_PER_CARE 25
#define LX_ENJOY_EMPTY_BEATS 20

/* G5: a need above the floor falls by `amount`; at the floor it holds while `holding`, then falls at an eighth */
static int32_t fall(int32_t v, int32_t amount, int holding) {
  int32_t floor = LX_NEED_FLOOR * LX_SUB;
  if (amount <= 0) return v;
  int32_t share = v > floor ? amount : holding ? 0 : imax(1, amount / LX_LOW_DECAY_DIVISOR);
  int32_t next = clamp_meter(v - share);
  return holding && v >= floor ? imax(next, floor) : next;
}

/* `alone`: the owner is away; a pet alone and awake loses joy twice as fast (G5) */
static void decay(lx_pet *p, int32_t beat, int alone) {
  /* a hibernating pet's food is empty: its sleep does not count toward growing up either */
  if (p->hibernating) {
    p->stalledBeats++;
    return;
  }
  /* the enjoyment bar empties a little every beat */
  if (p->enjoy) p->enjoy = imax(0, p->enjoy - (LX_ENJOY_PER_CARE + LX_ENJOY_EMPTY_BEATS - 1) / LX_ENJOY_EMPTY_BEATS);
  int32_t was[4];
  for (int i = 0; i < 4; i++) was[i] = p->meters[i];
  int32_t ill = p->sick ? 2 : 1;
  p->uncaredBeats++;
  int holding = p->uncaredBeats <= LX_FLOOR_HOLDS;
  p->meters[LX_FOOD] = fall(p->meters[LX_FOOD], less(p, LX_FOOD), holding);
  p->meters[LX_JOY] = fall(p->meters[LX_JOY], less(p, LX_JOY) * ill * (alone && !p->asleep ? 2 : 1), holding);
  p->meters[LX_CLEAN] = fall(p->meters[LX_CLEAN], less(p, LX_CLEAN), holding);
  p->meters[LX_ENERGY] = p->asleep ? clamp_meter(p->meters[LX_ENERGY] + boosted(SLEEP_GAIN_PER_HOUR, p->fx.sleepGain))
                                   : fall(p->meters[LX_ENERGY], less(p, LX_ENERGY) * ill, holding);
  /* in the game's order: food, joy, clean, energy */
  static const int order[4] = {LX_FOOD, LX_JOY, LX_CLEAN, LX_ENERGY};
  static const int kind[4] = {LX_MISS_FOOD, LX_MISS_JOY, LX_MISS_CLEAN, LX_MISS_ENERGY};
  for (int i = 0; i < 4; i++)
    if (was[order[i]] > 0 && p->meters[order[i]] == 0) miss(p, kind[i], beat);
  /* time with a need at zero does not count toward growing up */
  if (p->meters[LX_FOOD] == 0 || p->meters[LX_JOY] == 0 || p->meters[LX_CLEAN] == 0 || p->meters[LX_ENERGY] == 0) p->stalledBeats++;
  /* neglect: an empty food bowl or a filthy pet, a full day running, makes it ill */
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
}

/* while the floor holds, a need at the floor or above when the beat began ends it no lower (G5) */
static void hold_floor(lx_pet *p, const int32_t before[4]) {
  if (p->uncaredBeats > LX_FLOOR_HOLDS) return;
  int32_t floor = LX_NEED_FLOOR * LX_SUB;
  for (int i = 0; i < 4; i++)
    if (before[i] >= floor && p->meters[i] < floor) p->meters[i] = floor;
}

void lx_away_to(lx_pet *p, lx_circuit *brain, uint8_t *scratch, int32_t target) {
  if (target <= p->beat) return;
  int32_t gap = target - p->beat;
  int32_t skipped = imax(0, gap - LX_MAX_CATCH_UP);
  /* the needs decay through the whole absence (up to DECAY_SPAN), the brain thinks only through its last beats */
  for (int32_t k = imax(0, skipped - (LX_DECAY_SPAN - LX_MAX_CATCH_UP)); k < skipped; k++) decay(p, p->beat + k + 1, 1);
  int32_t b = p->beat + skipped;
  while (b < target) {
    b++;
    decay(p, b, 1);
    if (!p->hibernating) {
      int32_t before[4];
      for (int i = 0; i < 4; i++) before[i] = p->meters[i];
      think(p, brain, scratch, b, LX_A_NONE, 0, 0);
      hold_floor(p, before);
    }
  }
  p->beat = target;
}

void lx_live(lx_pet *p, lx_circuit *brain, uint8_t *scratch) {
  int32_t target = p->beat + 1;
  p->beat = target;
  decay(p, target, 0);
  if (!p->hibernating) think(p, brain, scratch, target, LX_A_NONE, 0, 1);
}

/* G3: whether a care answers a need the pet has now; only that care is counted for evolution and can teach it */
static int answers_need(const lx_pet *p, int kind) {
  switch (kind) {
    case LX_C_FEED: return visible(p->meters[LX_FOOD]) < 600;
    case LX_C_PLAY: return visible(p->meters[LX_JOY]) < 700 && !p->sick;
    case LX_C_CLEAN: return visible(p->meters[LX_CLEAN]) < 600;
    case LX_C_PET: return visible(p->meters[LX_JOY]) < 800;
    case LX_C_LIGHTS: return visible(p->meters[LX_ENERGY]) < 400;
    case LX_C_MEDICINE: return p->sick ? 1 : 0;
    default: return 0;
  }
}

lx_note lx_care(lx_pet *p, lx_circuit *brain, uint8_t *scratch, int kind, const lx_food *food, int stars) {
  int action = LX_A_NONE;
  lx_note note = LX_N_LISTENED;
  int needed, rewarded;
  /* any care starts the floor's four days again (G5) */
  p->uncaredBeats = 0;
  if (p->hibernating && (kind == LX_C_FEED || kind == LX_C_PET || kind == LX_C_WAKE)) {
    p->hibernating = 0;
    p->asleep = 0;
    p->starvingBeats = 0;
    p->meters[LX_FOOD] = add_visible(p->meters[LX_FOOD], 200);
    p->meters[LX_JOY] = clamp_meter(p->meters[LX_JOY] - 100 * LX_SUB);
    return LX_N_HIBERNATION_ENDED;
  }
  needed = answers_need(p, kind);
  rewarded = needed && p->enjoy + LX_ENJOY_PER_CARE <= LX_ENJOY_MAX;
  if (needed && (kind == LX_C_FEED || kind == LX_C_PLAY || kind == LX_C_CLEAN || kind == LX_C_PET)) {
    int at = kind == LX_C_FEED ? 0 : kind == LX_C_PLAY ? 1 : kind == LX_C_CLEAN ? 2 : 3;
    if (!p->hasNeeds) {
      p->hasNeeds = 1;
      for (int i = 0; i < 4; i++) p->needs[i] = 0;
    }
    p->needs[at] = imin(255, p->needs[at] + 1);
  }
  /* a meal is thought about with the hunger the pet had when it came (G5) */
  int32_t foodWhenFed = p->meters[LX_FOOD];
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
      if (rewarded) gain_xp(p, 2 * s);
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
  /* taps inside one beat are one thought: the first is thought about and logged, the rest change only the meters */
  if (!p->hasCareBeat || p->careBeat != p->beat) {
    if (kind == LX_C_FEED) {
      int32_t fedTo = p->meters[LX_FOOD];
      p->meters[LX_FOOD] = foodWhenFed;
      think(p, brain, scratch, p->beat, action, 0, 1);
      p->meters[LX_FOOD] = fedTo;
    } else
      think(p, brain, scratch, p->beat, action, 0, 1);
    p->hasCareBeat = 1;
    p->careBeat = p->beat;
  }
  if (rewarded) {
    gain_xp(p, 1);
    p->enjoy = imin(LX_ENJOY_MAX, p->enjoy + LX_ENJOY_PER_CARE);
  }
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
  put32(&k, p->uncaredBeats);
  put32(&k, p->stalledBeats);
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
  put32(&k, p->enjoy);
  put8(&k, p->hasCareBeat);
  put32(&k, p->hasCareBeat ? p->careBeat : 0);
  put8(&k, p->hasNeeds);
  for (int i = 0; i < 4; i++) put32(&k, p->hasNeeds ? p->needs[i] : 0);
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
