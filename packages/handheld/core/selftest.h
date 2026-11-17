/*
 * The handheld's check of itself at boot: its evaluator, its keccak and its log chain against data from X Layer.
 *   1. each embedded starter brain hashes to the keccak-256 stored for it on chain, and loads;
 *   2. pet #1's saved mainnet log, replayed through the gentle brain, gives the log hash PetRegistry holds and the
 *      memory the game computes.
 * A handheld that fails says so on screen and refuses to take a pet.
 */
#ifndef LX_SELFTEST_H
#define LX_SELFTEST_H

#include "tap02.h"

typedef struct {
  const char *line;
  uint32_t circuit;
  const uint8_t *bytes;
  uint32_t len;
  const uint8_t *hash;
  uint32_t nState;
} lx_starter;

extern const lx_starter lx_starters[3];
extern const uint16_t lx_pet1_words[];
extern const uint32_t lx_pet1_count;
extern const uint8_t lx_pet1_hash[32];
extern const uint8_t lx_pet1_memory[];

typedef struct {
  uint8_t hashOk[3], loadOk[3];
  uint8_t pet1HashOk, pet1MemoryOk;
  uint8_t pass;
} lx_selftest;

/* uses the arena for its own loads, then gives the space back */
void lx_selftest_run(lx_selftest *r, lx_arena *a);

#endif
