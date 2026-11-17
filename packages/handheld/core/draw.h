/*
 * The handheld's screen: a 240x135 framebuffer of RGB565 pixels (the Cardputer's ST7789 at its native size), drawn
 * by the core itself, so the browser handheld shows the firmware's own pixels rather than a look-alike.
 */
#ifndef LX_DRAW_H
#define LX_DRAW_H

#include "lx.h"

#define LX_W 240
#define LX_H 135

typedef uint16_t lx_px;

typedef struct {
  uint8_t adv, w, h;
  int8_t xo, yo;
  uint32_t at;
} lx_glyph;

extern const int lx_font_ascent, lx_font_descent;
extern const uint32_t lx_font_count;
extern const uint32_t lx_font_cp[];
extern const lx_glyph lx_font_glyph[];
extern const uint8_t lx_font_bits[];

#define LX_LINE 14 /* line height of the 12px font, with room for descenders */

static inline lx_px lx_rgb(uint8_t r, uint8_t g, uint8_t b) { return (lx_px)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)); }

void lx_fill(lx_px *fb, int x, int y, int w, int h, lx_px c);
void lx_frame(lx_px *fb, int x, int y, int w, int h, lx_px c);
/* a box with its corners cut by one pixel, the game's rounded pixel style */
void lx_box(lx_px *fb, int x, int y, int w, int h, lx_px fill, lx_px edge);

/* decode one UTF-8 code point; returns bytes used (at least 1), U+FFFD for a bad sequence */
int lx_utf8(const char *s, uint32_t *cp);
/* width in pixels of text (or of its first `max` bytes when max >= 0) */
int lx_text_width(const char *s);
/* draw text with its top at y; clipped to x + maxW when maxW > 0 (an ellipsis marks the cut); returns the end x */
int lx_text(lx_px *fb, int x, int y, const char *s, lx_px c, int maxW);
/* centred in [x, x + w) */
void lx_text_centre(lx_px *fb, int x, int y, int w, const char *s, lx_px c);

/* a layer of runs (x, y, length, palette index), drawn at an integer scale with its origin at (ox, oy) */
void lx_runs(lx_px *fb, const uint8_t *runs, uint32_t nRuns, int ox, int oy, int dx, int dy, int scale, const lx_px *palette,
             int clipX, int clipY, int clipW, int clipH);

#endif
