#include "tap02.h"

void lx_arena_init(lx_arena *a, void *mem, size_t size) {
  a->base = (uint8_t *)mem;
  a->size = size;
  a->used = 0;
}

void *lx_alloc(lx_arena *a, size_t n) {
  size_t at = (a->used + 7) & ~(size_t)7;
  if (n > a->size || at > a->size - n) return NULL;
  a->used = at + n;
  return a->base + at;
}

static uint32_t u24(const uint8_t *p) { return ((uint32_t)p[0] << 16) | ((uint32_t)p[1] << 8) | p[2]; }

static const lx_part *find_part(const lx_part *parts, uint32_t n, const uint8_t cpu[20], uint64_t id) {
  for (uint32_t i = 0; i < n; i++)
    if (parts[i].id == id && lx_memcmp(parts[i].cpu, cpu, 20) == 0) return &parts[i];
  return NULL;
}

/* First pass: count records and input pins, so the arrays can be sized exactly. */
static lx_err scan(const uint8_t *b, uint32_t len, uint32_t *nEl, uint32_t *nIns) {
  uint32_t p = 0, e = 0, ins = 0;
  while (p < len) {
    uint8_t op = b[p++];
    uint32_t k;
    if (op == LX_NAND) k = 2;
    else if (op == LX_LATCH) k = 1;
    else if (op == LX_REF) {
      if (len - p < 30) return LX_TRUNCATED;
      k = b[p + 28];
      p += 30;
    } else return LX_BAD_OPCODE;
    if ((uint64_t)len - p < 3ull * k) return LX_TRUNCATED;
    p += 3 * k;
    ins += k;
    e++;
  }
  *nEl = e;
  *nIns = ins;
  return LX_OK;
}

static lx_err load_at(lx_arena *a, const uint8_t *b, uint32_t len, uint32_t nIn, uint32_t nOut, const lx_part *parts,
                      uint32_t nParts, int depth, lx_circuit **out) {
  if (depth > LX_MAX_DEPTH) return LX_TOO_DEEP;
  uint32_t nEl, nIns;
  lx_err err = scan(b, len, &nEl, &nIns);
  if (err) return err;
  lx_circuit *c = (lx_circuit *)lx_alloc(a, sizeof *c);
  lx_element *els = (lx_element *)lx_alloc(a, sizeof(lx_element) * (nEl ? nEl : 1));
  uint32_t *ins = (uint32_t *)lx_alloc(a, sizeof(uint32_t) * (nIns ? nIns : 1));
  if (!c || !els || !ins) return LX_NO_ROOM;
  lx_memset(c, 0, sizeof *c);
  c->nIn = nIn;
  c->nOut = nOut;
  c->els = els;
  c->ins = ins;
  c->nElements = nEl;

  /* decode, giving each element its outputs in record order */
  uint64_t next = 2 + (uint64_t)nIn;
  uint32_t p = 0, at = 0;
  for (uint32_t i = 0; i < nEl; i++) {
    lx_element *e = &els[i];
    lx_memset(e, 0, sizeof *e);
    e->op = b[p++];
    e->firstOut = (uint32_t)(next > 0xffffffffu ? 0xffffffffu : next);
    e->insAt = at;
    if (e->op == LX_NAND) {
      e->nIns = 2;
      e->nOut = 1;
    } else if (e->op == LX_LATCH) {
      e->nIns = 1;
      e->nOut = 1;
    } else {
      uint8_t cpu[20];
      lx_memcpy(cpu, b + p, 20);
      uint64_t id = 0;
      for (int j = 0; j < 8; j++) id = (id << 8) | b[p + 20 + j];
      e->nIns = b[p + 28];
      e->nOut = b[p + 29];
      p += 30;
      const lx_part *part = find_part(parts, nParts, cpu, id);
      if (!part) return LX_NO_TARGET;
      if (part->nIn != e->nIns || part->nOut != e->nOut) return LX_BAD_ARITY;
      err = load_at(a, part->bytes, part->len, part->nIn, part->nOut, parts, nParts, depth + 1, &e->sub);
      if (err) return err;
      lx_memcpy(e->sub->cpu, cpu, 20);
      e->sub->id = id;
    }
    for (uint32_t j = 0; j < e->nIns; j++, p += 3) ins[at++] = u24(b + p);
    next += e->nOut;
  }

  /* well-formedness, as packages/brain `load` checks it */
  if (next > LX_MAX_SIGNALS) return LX_BAD_SHAPE;
  if (nIn > LX_MAX_PINS || nOut < 1 || nOut > LX_MAX_PINS) return LX_BAD_SHAPE;
  if (next - 2 - nIn < nOut) return LX_BAD_SHAPE;
  c->nSignals = (uint32_t)next;
  uint64_t nState = 0, nGates = 0;
  for (uint32_t i = 0; i < nEl; i++) {
    lx_element *e = &els[i];
    uint32_t limit = e->op == LX_LATCH ? c->nSignals : e->firstOut;
    for (uint32_t j = 0; j < e->nIns; j++)
      if (ins[e->insAt + j] >= limit) return LX_BAD_SIGNAL;
    e->stateBase = (uint32_t)nState;
    if (e->op == LX_LATCH) nState += 1;
    else if (e->op == LX_REF) {
      nState += e->sub->nState;
      nGates += e->sub->nGates;
    }
  }
  for (uint32_t i = 0; i < nEl; i++)
    if (els[i].op != LX_REF) nGates++;
  if (nState > LX_MAX_SIGNALS || nGates > 0xffffffffull) return LX_BAD_SHAPE;
  c->nState = (uint32_t)nState;
  c->nGates = (uint32_t)nGates;
  c->sig = (uint8_t *)lx_alloc(a, c->nSignals);
  if (!c->sig) return LX_NO_ROOM;
  *out = c;
  return LX_OK;
}

lx_err lx_load(lx_arena *a, const uint8_t *bytes, uint32_t len, uint32_t nIn, uint32_t nOut, const lx_part *parts,
               uint32_t nParts, lx_circuit **out) {
  size_t mark = a->used;
  lx_err err = load_at(a, bytes, len, nIn, nOut, parts, nParts, 0, out);
  if (err) a->used = mark;
  return err;
}

void lx_beat(lx_circuit *c, const uint8_t *state, uint8_t *next, const uint8_t *inputs, uint8_t *outputs) {
  uint8_t *a = c->sig;
  a[0] = 0;
  a[1] = 1;
  for (uint32_t i = 0; i < c->nIn; i++) a[2 + i] = inputs[i] ? 1 : 0;
  for (uint32_t i = 0; i < c->nState; i++) next[i] = state[i] ? 1 : 0;
  for (uint32_t k = 0; k < c->nElements; k++) {
    lx_element *e = &c->els[k];
    const uint32_t *in = c->ins + e->insAt;
    if (e->op == LX_NAND) {
      a[e->firstOut] = (a[in[0]] & a[in[1]]) ? 0 : 1;
    } else if (e->op == LX_LATCH) {
      a[e->firstOut] = state[e->stateBase] ? 1 : 0;
    } else {
      /* the sub-circuit reads its pins from this circuit's signals; its outputs land after them */
      lx_circuit *s = e->sub;
      uint8_t pins[256];
      for (uint32_t j = 0; j < e->nIns; j++) pins[j] = a[in[j]];
      lx_beat(s, state + e->stateBase, next + e->stateBase, pins, a + e->firstOut);
    }
  }
  for (uint32_t k = 0; k < c->nElements; k++) {
    lx_element *e = &c->els[k];
    if (e->op == LX_LATCH) next[e->stateBase] = c->sig[c->ins[e->insAt]];
  }
  for (uint32_t i = 0; i < c->nOut; i++) outputs[i] = a[c->nSignals - c->nOut + i];
}

uint32_t lx_step_word(lx_circuit *c, uint8_t *state, uint8_t *scratch, uint32_t word) {
  uint8_t in[32], out[32];
  for (uint32_t i = 0; i < c->nIn && i < 32; i++) in[i] = (word >> i) & 1;
  lx_beat(c, state, scratch, in, out);
  lx_memcpy(state, scratch, c->nState);
  uint32_t w = 0;
  for (uint32_t i = 0; i < c->nOut && i < 32; i++) w |= (uint32_t)out[i] << i;
  return w;
}
