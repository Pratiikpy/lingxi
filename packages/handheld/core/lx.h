/*
 * Lingxi on a handheld: the shared C core (plan 4.14).
 *
 * The same files build for the browser (WebAssembly), for the host's tests and for the ESP32-S3 of an M5Stack
 * Cardputer. Nothing here reaches outside the core: no libc beyond what lx_mem provides, no heap, no clock, no
 * screen or keys. The platform layer hands in time and keys and takes out a framebuffer and bytes.
 */
#ifndef LX_H
#define LX_H

#include <stdint.h>
#include <stddef.h>

typedef enum {
  LX_OK = 0,
  LX_TRUNCATED = 1,      /* a record or a field runs past the end of its bytes */
  LX_BAD_OPCODE = 2,     /* a netlist record that is not NAND, LATCH or REF */
  LX_BAD_SIGNAL = 3,     /* an element reads a signal that is not yet available */
  LX_BAD_SHAPE = 4,      /* inputs, outputs or sizes out of range */
  LX_NO_TARGET = 5,      /* a REF whose circuit was not handed over */
  LX_BAD_ARITY = 6,      /* a REF whose pin counts differ from its circuit */
  LX_TOO_DEEP = 7,       /* REFs nested deeper than LX_MAX_DEPTH */
  LX_NO_ROOM = 8,        /* the arena is full */
  LX_BAD_MAGIC = 9,      /* not a Lingxi packet */
  LX_BAD_VERSION = 10,   /* a packet of a version this core does not read */
  LX_BAD_HASH = 11,      /* the brain's bytes do not hash to the keccak the packet names */
  LX_BAD_CHECK = 12,     /* the packet's own checksum does not match its bytes */
  LX_BAD_VALUE = 13      /* a field holds a value outside its range */
} lx_err;

/* bytes and memory, without libc */
void lx_memcpy(void *dst, const void *src, size_t n);
void lx_memset(void *dst, int v, size_t n);
int lx_memcmp(const void *a, const void *b, size_t n);

/* keccak-256 as Ethereum uses it (padding 0x01) */
typedef struct {
  uint64_t s[25];
  uint8_t buf[136];
  uint32_t n;
} lx_keccak;
void lx_keccak_init(lx_keccak *k);
void lx_keccak_update(lx_keccak *k, const uint8_t *data, size_t len);
void lx_keccak_final(lx_keccak *k, uint8_t out[32]);
void lx_keccak256(const uint8_t *data, size_t len, uint8_t out[32]);

/* the input log, chained exactly as PetRegistry.chainLog: h' = keccak256(h ‖ uint16 word) */
void lx_chain_log(uint8_t h[32], uint16_t word);

#endif
