#include "selftest.h"

void lx_selftest_run(lx_selftest *r, lx_arena *a) {
  size_t mark = a->used;
  lx_memset(r, 0, sizeof *r);
  lx_circuit *gentle = 0;
  for (int i = 0; i < 3; i++) {
    const lx_starter *s = &lx_starters[i];
    uint8_t h[32];
    lx_keccak256(s->bytes, s->len, h);
    r->hashOk[i] = lx_memcmp(h, s->hash, 32) == 0;
    lx_circuit *c = 0;
    r->loadOk[i] = lx_load(a, s->bytes, s->len, 16, 8, 0, 0, &c) == LX_OK && c->nState == s->nState;
    if (i == 0 && r->loadOk[i]) gentle = c;
  }
  if (gentle) {
    uint8_t state[64], scratch[64], h[32];
    lx_memset(state, 0, sizeof state);
    lx_memset(h, 0, 32);
    for (uint32_t k = 0; k < lx_pet1_count; k++) {
      lx_chain_log(h, lx_pet1_words[k]);
      lx_step_word(gentle, state, scratch, lx_pet1_words[k]);
    }
    r->pet1HashOk = lx_memcmp(h, lx_pet1_hash, 32) == 0;
    r->pet1MemoryOk = lx_memcmp(state, lx_pet1_memory, gentle->nState) == 0;
  }
  r->pass = r->hashOk[0] && r->hashOk[1] && r->hashOk[2] && r->loadOk[0] && r->loadOk[1] && r->loadOk[2] && r->pet1HashOk &&
            r->pet1MemoryOk;
  a->used = mark;
}
