/* keccak-256 (the Ethereum variant, pad byte 0x01), the 1600-bit permutation over 24 rounds. */
#include "lx.h"

void lx_memcpy(void *dst, const void *src, size_t n) {
  uint8_t *d = (uint8_t *)dst;
  const uint8_t *s = (const uint8_t *)src;
  while (n--) *d++ = *s++;
}

void lx_memset(void *dst, int v, size_t n) {
  uint8_t *d = (uint8_t *)dst;
  while (n--) *d++ = (uint8_t)v;
}

int lx_memcmp(const void *a, const void *b, size_t n) {
  const uint8_t *x = (const uint8_t *)a, *y = (const uint8_t *)b;
  for (size_t i = 0; i < n; i++)
    if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

static const uint64_t RC[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL, 0x8000000080008000ULL,
    0x000000000000808bULL, 0x0000000080000001ULL, 0x8000000080008081ULL, 0x8000000000008009ULL,
    0x000000000000008aULL, 0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL, 0x8000000000008003ULL,
    0x8000000000008002ULL, 0x8000000000000080ULL, 0x000000000000800aULL, 0x800000008000000aULL,
    0x8000000080008081ULL, 0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL};
static const uint8_t ROT[25] = {0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14};

static uint64_t rol(uint64_t x, unsigned r) { return r ? (x << r) | (x >> (64 - r)) : x; }

static void permute(uint64_t a[25]) {
  for (int round = 0; round < 24; round++) {
    uint64_t c[5], d[5], b[25];
    for (int x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (int x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ rol(c[(x + 1) % 5], 1);
    for (int i = 0; i < 25; i++) a[i] ^= d[i % 5];
    /* rho and pi: b[y, 2x+3y] = rol(a[x, y]) */
    for (int x = 0; x < 5; x++)
      for (int y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rol(a[x + 5 * y], ROT[x + 5 * y]);
    for (int x = 0; x < 5; x++)
      for (int y = 0; y < 5; y++) a[x + 5 * y] = b[x + 5 * y] ^ (~b[(x + 1) % 5 + 5 * y] & b[(x + 2) % 5 + 5 * y]);
    a[0] ^= RC[round];
  }
}

static void absorb_block(lx_keccak *k) {
  for (int i = 0; i < 17; i++) {
    uint64_t lane = 0;
    for (int j = 7; j >= 0; j--) lane = (lane << 8) | k->buf[8 * i + j];
    k->s[i] ^= lane;
  }
  permute(k->s);
  k->n = 0;
}

void lx_keccak_init(lx_keccak *k) { lx_memset(k, 0, sizeof *k); }

void lx_keccak_update(lx_keccak *k, const uint8_t *data, size_t len) {
  while (len--) {
    k->buf[k->n++] = *data++;
    if (k->n == 136) absorb_block(k);
  }
}

void lx_keccak_final(lx_keccak *k, uint8_t out[32]) {
  lx_memset(k->buf + k->n, 0, 136 - k->n);
  k->buf[k->n] ^= 0x01;
  k->buf[135] ^= 0x80;
  absorb_block(k);
  for (int i = 0; i < 4; i++)
    for (int j = 0; j < 8; j++) out[8 * i + j] = (uint8_t)(k->s[i] >> (8 * j));
}

void lx_keccak256(const uint8_t *data, size_t len, uint8_t out[32]) {
  lx_keccak k;
  lx_keccak_init(&k);
  lx_keccak_update(&k, data, len);
  lx_keccak_final(&k, out);
}

void lx_chain_log(uint8_t h[32], uint16_t word) {
  uint8_t b[34];
  lx_memcpy(b, h, 32);
  b[32] = (uint8_t)(word >> 8);
  b[33] = (uint8_t)word;
  lx_keccak256(b, 34, h);
}
