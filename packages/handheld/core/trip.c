#include "trip.h"

typedef struct {
  const uint8_t *b;
  uint32_t len, p;
  int bad;
} rd;

static int need(rd *r, uint32_t n) {
  if (r->bad || n > r->len - r->p) {
    r->bad = 1;
    return 0;
  }
  return 1;
}
static uint8_t r8(rd *r) { return need(r, 1) ? r->b[r->p++] : 0; }
static uint16_t r16(rd *r) {
  if (!need(r, 2)) return 0;
  uint16_t v = (uint16_t)(r->b[r->p] | (r->b[r->p + 1] << 8));
  r->p += 2;
  return v;
}
static uint32_t r32u(rd *r) {
  if (!need(r, 4)) return 0;
  uint32_t v = (uint32_t)r->b[r->p] | ((uint32_t)r->b[r->p + 1] << 8) | ((uint32_t)r->b[r->p + 2] << 16) |
               ((uint32_t)r->b[r->p + 3] << 24);
  r->p += 4;
  return v;
}
static int32_t r32(rd *r) { return (int32_t)r32u(r); }
static uint64_t r64(rd *r) {
  uint64_t lo = r32u(r), hi = r32u(r);
  return lo | (hi << 32);
}
static const uint8_t *rbytes(rd *r, uint32_t n) {
  if (!need(r, n)) return NULL;
  const uint8_t *p = r->b + r->p;
  r->p += n;
  return p;
}

lx_err lx_trip_open(lx_trip *t, lx_arena *a, const uint8_t *bytes, uint32_t len) {
  lx_memset(t, 0, sizeof *t);
  if (len < 4 + 1 + 32 || lx_memcmp(bytes, "LXH1", 4) != 0) return LX_BAD_MAGIC;
  if (bytes[4] != LX_TRIP_VERSION) return LX_BAD_VERSION;
  uint8_t check[32];
  lx_keccak256(bytes, len - 32, check);
  if (lx_memcmp(check, bytes + len - 32, 32) != 0) return LX_BAD_CHECK;
  rd r = {bytes, len - 32, 5, 0};
  lx_pet *p = &t->pet;

  p->beat = r32(&r);
  p->tzOffsetMin = r32(&r);
  for (int i = 0; i < 4; i++) p->meters[i] = r32(&r);
  p->asleep = r8(&r);
  p->hibernating = r8(&r);
  p->sick = r8(&r);
  p->starvingBeats = r32(&r);
  p->dirtyBeats = r32(&r);
  p->mistakes = r32(&r);
  p->nMissed = r8(&r);
  if (p->nMissed > LX_MISSED_KEPT) return LX_BAD_VALUE;
  for (int i = 0; i < p->nMissed; i++) {
    p->missedKind[i] = r8(&r);
    p->missedBeat[i] = r32(&r);
  }
  p->kinship = r32(&r);
  p->hasKinBeat = r8(&r);
  p->kinBeat = r32(&r);
  p->nBrain = r16(&r);
  if (p->nBrain > LX_MAX_STATE) return LX_BAD_VALUE;
  for (uint32_t i = 0; i < p->nBrain; i++) p->brain[i] = r8(&r) ? 1 : 0;
  for (int i = 0; i < 7; i++) p->traits[i] = r32(&r);
  p->xp = r32(&r);
  p->xpCarry = r32(&r);
  p->traitCarry = r32(&r);
  for (int i = 0; i < 5; i++) p->counts[i] = r32(&r);
  for (int i = 0; i < 4; i++) p->diet[i] = r32(&r);
  const uint8_t *h = rbytes(&r, 32);
  if (h) lx_memcpy(p->logHash, h, 32);
  p->hasLogBeat = r8(&r);
  p->logBeat = r32(&r);
  p->lastWant = r8(&r);
  p->lastMood = r8(&r);
  p->lastNudge = r8(&r);
  p->lastWord = r16(&r);
  for (int i = 0; i < 4; i++) p->fx.decayLeft[i] = r16(&r);
  p->fx.sleepGain = (int16_t)r16(&r);
  p->fx.sickGrace = (int16_t)r16(&r);
  p->fx.hibernateGrace = (int16_t)r16(&r);
  p->fx.foodItem = (int16_t)r16(&r);
  p->fx.joyItem = (int16_t)r16(&r);
  p->fx.bathJoy = (int16_t)r16(&r);
  p->fx.kinshipKeep = (int16_t)r16(&r);
  p->fx.kinshipSooner = (int16_t)r16(&r);
  p->fx.xpGain = (int16_t)r16(&r);
  p->fx.traitGrowth = (int16_t)r16(&r);

  t->bornBeat = r32(&r);
  t->line = r8(&r);
  t->stage = r8(&r);
  t->form = r8(&r);
  t->colour = r8(&r);
  t->lang = r8(&r);
  uint8_t nameLen = r8(&r);
  if (nameLen > LX_NAME_MAX) return LX_BAD_VALUE;
  const uint8_t *name = rbytes(&r, nameLen);
  if (name) lx_memcpy(t->name, name, nameLen);
  t->name[nameLen] = 0;

  t->nSnacks = r8(&r);
  if (t->nSnacks > LX_MAX_SNACKS) return LX_BAD_VALUE;
  for (int i = 0; i < t->nSnacks; i++) {
    lx_snack *s = &t->snacks[i];
    s->index = (uint8_t)i;
    s->count = r16(&r);
    s->food.food = (int16_t)r16(&r);
    s->food.joy = (int16_t)r16(&r);
    s->food.energy = (int16_t)r16(&r);
    s->food.xp = (int16_t)r16(&r);
    s->food.diet = (int8_t)r8(&r);
    uint8_t idLen = r8(&r);
    if (idLen > 15) return LX_BAD_VALUE;
    const uint8_t *id = rbytes(&r, idLen);
    if (id) lx_memcpy(s->id, id, idLen);
    s->id[idLen] = 0;
    for (int k = 0; k < 2; k++) {
      char *dst = k ? s->nameZh : s->nameEn;
      uint8_t nl = r8(&r);
      if (nl > LX_SNACK_NAME) return LX_BAD_VALUE;
      const uint8_t *nm = rbytes(&r, nl);
      if (nm) lx_memcpy(dst, nm, nl);
      dst[nl] = 0;
    }
  }

  const uint8_t *proc = rbytes(&r, 20);
  if (proc) lx_memcpy(t->processor, proc, 20);
  t->brainId = r64(&r);
  uint16_t nIn = r16(&r), nOut = r16(&r);
  uint32_t rootLen = r32u(&r);
  const uint8_t *root = rbytes(&r, rootLen);
  const uint8_t *want = rbytes(&r, 32);
  if (want) lx_memcpy(t->brainHash, want, 32);
  t->nParts = r8(&r);
  if (t->nParts > LX_MAX_PARTS) return LX_BAD_VALUE;
  for (int i = 0; i < t->nParts; i++) {
    lx_part *q = &t->parts[i];
    const uint8_t *cpu = rbytes(&r, 20);
    if (cpu) lx_memcpy(q->cpu, cpu, 20);
    q->id = r64(&r);
    q->nIn = r16(&r);
    q->nOut = r16(&r);
    q->len = r32u(&r);
    q->bytes = rbytes(&r, q->len);
  }
  if (r.bad) return LX_TRUNCATED;
  if (r.p != r.len) return LX_BAD_VALUE;

  /* the brain the packet names, and nothing else, is run */
  uint8_t got[32];
  lx_keccak256(root, rootLen, got);
  if (lx_memcmp(got, t->brainHash, 32) != 0) return LX_BAD_HASH;
  lx_err err = lx_load(a, root, rootLen, nIn, nOut, t->parts, t->nParts, &t->brain);
  if (err) return err;
  /* the parts' bytes are in the caller's packet buffer, which it may reuse: the loaded brain needs none of them */
  for (int i = 0; i < t->nParts; i++) t->parts[i].bytes = 0;
  if (t->brain->nIn != 16 || t->brain->nOut != 8 || t->brain->nState != p->nBrain) return LX_BAD_SHAPE;

  p->logLength = 0;
  lx_pet_digest(p, t->startDigest);
  return LX_OK;
}

void lx_log_init(lx_log *g, uint8_t *buf, uint32_t cap) {
  g->buf = buf;
  g->cap = cap;
  g->len = 0;
  g->liveAt = 0;
  g->liveRun = 0;
}

static int put(lx_log *g, const uint8_t *b, uint32_t n) {
  if (n > g->cap - g->len) return 0;
  lx_memcpy(g->buf + g->len, b, n);
  g->len += n;
  return 1;
}

int lx_log_fits(const lx_log *g, uint8_t op) {
  uint32_t need = op == LX_OP_AWAY ? 5 : op == LX_OP_CARE ? 3 : (g->liveAt && g->liveRun < 0xffff) ? 0 : 3;
  return need <= g->cap - g->len;
}

int lx_log_live(lx_log *g) {
  if (g->liveAt && g->liveRun < 0xffff) {
    g->liveRun++;
    g->buf[g->liveAt] = (uint8_t)g->liveRun;
    g->buf[g->liveAt + 1] = (uint8_t)(g->liveRun >> 8);
    return 1;
  }
  uint8_t b[3] = {LX_OP_LIVE, 1, 0};
  if (!put(g, b, 3)) return 0;
  g->liveAt = g->len - 2;
  g->liveRun = 1;
  return 1;
}

int lx_log_away(lx_log *g, uint32_t n) {
  uint8_t b[5] = {LX_OP_AWAY, (uint8_t)n, (uint8_t)(n >> 8), (uint8_t)(n >> 16), (uint8_t)(n >> 24)};
  g->liveAt = 0;
  return put(g, b, 5);
}

int lx_log_care(lx_log *g, uint8_t kind, uint8_t arg) {
  uint8_t b[3] = {LX_OP_CARE, kind, arg};
  g->liveAt = 0;
  return put(g, b, 3);
}

uint32_t lx_trip_close(const lx_trip *t, const lx_log *g, uint8_t *out, uint32_t cap) {
  uint32_t n = 4 + 1 + 32 + 4 + g->len + 32 + 4 + 32;
  if (n > cap) return 0;
  uint32_t p = 0;
  lx_memcpy(out, "LXR1", 4);
  p += 4;
  out[p++] = LX_TRIP_VERSION;
  lx_memcpy(out + p, t->startDigest, 32);
  p += 32;
  for (int i = 0; i < 4; i++) out[p++] = (uint8_t)(g->len >> (8 * i));
  lx_memcpy(out + p, g->buf, g->len);
  p += g->len;
  lx_pet_digest(&t->pet, out + p);
  p += 32;
  for (int i = 0; i < 4; i++) out[p++] = (uint8_t)((uint32_t)t->pet.beat >> (8 * i));
  lx_keccak256(out, p, out + p);
  return p + 32;
}
