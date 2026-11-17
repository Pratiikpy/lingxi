/*
 * TapeOut netlists (TAP-02) as the processors on X Layer run them, record for record:
 *
 *   NAND   0x00 a(u24) b(u24)                          one output, reads earlier signals
 *   LATCH  0x01 d(u24)                                 one output: last beat's stored bit; d may point forward
 *   REF    0x02 cpu(20) id(u64) nIns(u8) nOuts(u8) ins(u24 each)
 *                                                      a sub-circuit; its state is a block of this one's state
 *
 * Signal 0 is constant 0, 1 is constant 1, then the inputs, then each element's outputs in record order. The
 * circuit's outputs are its last nOut signals. Well-formedness is checked exactly as packages/brain `load` does,
 * so a netlist the browser refuses is refused here too, and one it runs is run the same way.
 */
#ifndef LX_TAP02_H
#define LX_TAP02_H

#include "lx.h"

#define LX_NAND 0x00
#define LX_LATCH 0x01
#define LX_REF 0x02
#define LX_MAX_SIGNALS (1u << 24)
#define LX_MAX_PINS (1u << 16)
/* REFs within REFs: Lingxi composes at most four levels (packages/brain PARTS_MAX_DEPTH); this allows more */
#define LX_MAX_DEPTH 8

typedef struct lx_circuit lx_circuit;

typedef struct {
  uint8_t op;
  uint16_t nOut;
  uint32_t firstOut;
  uint32_t stateBase;
  uint32_t nIns;
  uint32_t insAt; /* index of the first input in the circuit's `ins` */
  lx_circuit *sub; /* REF only */
} lx_element;

struct lx_circuit {
  uint32_t nIn, nOut, nSignals, nState, nGates, nElements;
  uint8_t cpu[20];
  uint64_t id;
  lx_element *els;
  uint32_t *ins;
  uint8_t *sig; /* one byte per signal, reused every beat */
};

/* A circuit handed over by the game, by the processor and id a REF names. */
typedef struct {
  uint8_t cpu[20];
  uint64_t id;
  uint32_t nIn, nOut;
  const uint8_t *bytes;
  uint32_t len;
} lx_part;

/* Memory for loaded circuits, carved from one buffer the platform owns. */
typedef struct {
  uint8_t *base;
  size_t size, used;
  size_t peak; /* the most ever in use at once: what a platform must provide */
} lx_arena;

void lx_arena_init(lx_arena *a, void *mem, size_t size);
void *lx_alloc(lx_arena *a, size_t n);

/*
 * Load the root netlist; REF targets are looked up among `parts` (every circuit any REF in the tree names).
 * On success *out points into the arena; on failure nothing in the arena may be used.
 */
lx_err lx_load(lx_arena *a, const uint8_t *bytes, uint32_t len, uint32_t nIn, uint32_t nOut, const lx_part *parts,
               uint32_t nParts, lx_circuit **out);

/*
 * One beat. `state` and `next` hold one byte per state bit (0 or 1) and may not overlap; `inputs` and `outputs`
 * one byte per pin. Returns nothing: a loaded circuit cannot fail to run.
 */
void lx_beat(lx_circuit *c, const uint8_t *state, uint8_t *next, const uint8_t *inputs, uint8_t *outputs);

/* The pet's convenience: input word in, output word back; `state` is updated in place. */
uint32_t lx_step_word(lx_circuit *c, uint8_t *state, uint8_t *scratch, uint32_t word);

#endif
