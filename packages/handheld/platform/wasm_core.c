/*
 * The core's entry points for WebAssembly: the browser handheld and the tests drive the same functions the
 * firmware calls. Memory is static; JavaScript writes bytes into `lx_in` and reads results from `lx_out`.
 */
#include "../core/trip.h"

#define EXPORT(name) __attribute__((export_name(#name)))

static uint8_t arena_mem[512 * 1024];
static uint8_t in_buf[256 * 1024];
static uint8_t out_buf[128 * 1024];
static uint8_t log_mem[96 * 1024];
static uint8_t scratch[LX_MAX_STATE];

static lx_arena arena;
static lx_trip trip;
static lx_log trip_log;
static int trip_ready;

/* freestanding: the compiler may emit calls to these */
void *memcpy(void *d, const void *s, size_t n) {
  lx_memcpy(d, s, n);
  return d;
}
void *memset(void *d, int v, size_t n) {
  lx_memset(d, v, n);
  return d;
}
int memcmp(const void *a, const void *b, size_t n) { return lx_memcmp(a, b, n); }

EXPORT(lx_in) uint8_t *wasm_in(void) { return in_buf; }
EXPORT(lx_out) uint8_t *wasm_out(void) { return out_buf; }

EXPORT(lx_keccak) void wasm_keccak(uint32_t len) { lx_keccak256(in_buf, len, out_buf); }

EXPORT(lx_chain) void wasm_chain(uint32_t word) { lx_chain_log(out_buf, (uint16_t)word); }

/* ── a trip ─────────────────────────────────────────────────────────────── */

EXPORT(lx_trip_open) int wasm_trip_open(uint32_t len) {
  lx_arena_init(&arena, arena_mem, sizeof arena_mem);
  lx_log_init(&trip_log, log_mem, sizeof log_mem);
  trip_ready = 0;
  lx_err e = lx_trip_open(&trip, &arena, in_buf, len);
  if (e == LX_OK) trip_ready = 1;
  return (int)e;
}

EXPORT(lx_trip_live) int wasm_trip_live(void) {
  if (!trip_ready) return -1;
  lx_live(&trip.pet, trip.brain, scratch);
  return lx_log_live(&trip_log) ? 0 : -2;
}

EXPORT(lx_trip_away) int wasm_trip_away(uint32_t n) {
  if (!trip_ready || n == 0) return -1;
  lx_away_to(&trip.pet, trip.brain, scratch, trip.pet.beat + (int32_t)n);
  return lx_log_away(&trip_log, n) ? 0 : -2;
}

/* care: the note, or -1 not open, -2 log full, -3 no such snack left */
EXPORT(lx_trip_care) int wasm_trip_care(uint32_t kind, uint32_t arg) {
  if (!trip_ready) return -1;
  const lx_food *food = 0;
  if (kind == LX_C_FEED) {
    if (arg >= trip.nSnacks || trip.snacks[arg].count == 0) return -3;
    trip.snacks[arg].count--;
    food = &trip.snacks[arg].food;
  }
  lx_note n = lx_care(&trip.pet, trip.brain, scratch, (int)kind, food, (int)arg);
  return lx_log_care(&trip_log, (uint8_t)kind, (uint8_t)arg) ? (int)n : -2;
}

EXPORT(lx_trip_digest) void wasm_trip_digest(void) { lx_pet_digest(&trip.pet, out_buf); }
EXPORT(lx_trip_close) uint32_t wasm_trip_close(void) { return lx_trip_close(&trip, &trip_log, out_buf, sizeof out_buf); }
EXPORT(lx_trip_pet) lx_pet *wasm_trip_pet(void) { return &trip.pet; }
EXPORT(lx_trip_state) lx_trip *wasm_trip_state(void) { return &trip; }

/* ── a bare circuit, for the evaluator's own tests ──────────────────────── */

static lx_circuit *circ;
static lx_part circ_parts[LX_MAX_PARTS];

/* in_buf: nIn u16, nOut u16, len u32, bytes, nParts u8, parts as in a trip packet */
EXPORT(lx_circ_load) int wasm_circ_load(uint32_t total) {
  lx_arena_init(&arena, arena_mem, sizeof arena_mem);
  const uint8_t *b = in_buf;
  uint32_t p = 0;
#define NEED(n) \
  if ((n) > total - p) return (int)LX_TRUNCATED
  NEED(8);
  uint32_t nIn = b[0] | (b[1] << 8), nOut = b[2] | (b[3] << 8);
  uint32_t len = b[4] | (b[5] << 8) | ((uint32_t)b[6] << 16) | ((uint32_t)b[7] << 24);
  p = 8;
  NEED(len);
  const uint8_t *root = b + p;
  p += len;
  NEED(1);
  uint32_t nParts = b[p++];
  if (nParts > LX_MAX_PARTS) return (int)LX_BAD_VALUE;
  for (uint32_t i = 0; i < nParts; i++) {
    lx_part *q = &circ_parts[i];
    NEED(36);
    lx_memcpy(q->cpu, b + p, 20);
    p += 20;
    q->id = 0;
    for (int j = 7; j >= 0; j--) q->id = (q->id << 8) | b[p + j];
    p += 8;
    q->nIn = b[p] | (b[p + 1] << 8);
    q->nOut = b[p + 2] | (b[p + 3] << 8);
    q->len = b[p + 4] | (b[p + 5] << 8) | ((uint32_t)b[p + 6] << 16) | ((uint32_t)b[p + 7] << 24);
    p += 8;
    NEED(q->len);
    q->bytes = b + p;
    p += q->len;
  }
#undef NEED
  return (int)lx_load(&arena, root, len, nIn, nOut, circ_parts, nParts, &circ);
}

EXPORT(lx_circ_shape) uint32_t wasm_circ_shape(uint32_t which) {
  if (!circ) return 0;
  return which == 0 ? circ->nIn : which == 1 ? circ->nOut : which == 2 ? circ->nState : circ->nGates;
}

/* out_buf: state (nState bytes) then inputs (nIn bytes) in; next state then outputs out, at the same offsets */
EXPORT(lx_circ_beat) void wasm_circ_beat(void) {
  static uint8_t next[1 << 14], outs[1 << 12];
  uint8_t *state = out_buf, *inputs = out_buf + circ->nState;
  lx_beat(circ, state, next, inputs, outs);
  lx_memcpy(out_buf, next, circ->nState);
  lx_memcpy(out_buf + circ->nState, outs, circ->nOut);
}
