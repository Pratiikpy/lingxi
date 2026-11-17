#include "draw.h"

static void px(lx_px *fb, int x, int y, lx_px c) {
  if ((unsigned)x < LX_W && (unsigned)y < LX_H) fb[y * LX_W + x] = c;
}

void lx_fill(lx_px *fb, int x, int y, int w, int h, lx_px c) {
  int x0 = x < 0 ? 0 : x, y0 = y < 0 ? 0 : y;
  int x1 = x + w > LX_W ? LX_W : x + w, y1 = y + h > LX_H ? LX_H : y + h;
  for (int j = y0; j < y1; j++)
    for (int i = x0; i < x1; i++) fb[j * LX_W + i] = c;
}

void lx_frame(lx_px *fb, int x, int y, int w, int h, lx_px c) {
  lx_fill(fb, x, y, w, 1, c);
  lx_fill(fb, x, y + h - 1, w, 1, c);
  lx_fill(fb, x, y, 1, h, c);
  lx_fill(fb, x + w - 1, y, 1, h, c);
}

void lx_box(lx_px *fb, int x, int y, int w, int h, lx_px fill, lx_px edge) {
  lx_fill(fb, x + 1, y + 1, w - 2, h - 2, fill);
  lx_fill(fb, x + 1, y, w - 2, 1, edge);
  lx_fill(fb, x + 1, y + h - 1, w - 2, 1, edge);
  lx_fill(fb, x, y + 1, 1, h - 2, edge);
  lx_fill(fb, x + w - 1, y + 1, 1, h - 2, edge);
}

int lx_utf8(const char *s, uint32_t *cp) {
  const uint8_t *u = (const uint8_t *)s;
  if (u[0] < 0x80) {
    *cp = u[0];
    return 1;
  }
  int n = u[0] >= 0xF0 && u[0] <= 0xF4 ? 3 : u[0] >= 0xE0 ? 2 : u[0] >= 0xC2 && u[0] < 0xE0 ? 1 : -1;
  if (n < 0) {
    *cp = 0xFFFD;
    return 1;
  }
  uint32_t v = u[0] & (0x3F >> n);
  for (int i = 1; i <= n; i++) {
    if ((u[i] & 0xC0) != 0x80) {
      *cp = 0xFFFD;
      return i;
    }
    v = (v << 6) | (u[i] & 0x3F);
  }
  *cp = v;
  return n + 1;
}

static const lx_glyph *glyph(uint32_t cp) {
  uint32_t lo = 0, hi = lx_font_count;
  while (lo < hi) {
    uint32_t mid = (lo + hi) / 2;
    if (lx_font_cp[mid] < cp) lo = mid + 1;
    else hi = mid;
  }
  return lo < lx_font_count && lx_font_cp[lo] == cp ? &lx_font_glyph[lo] : 0;
}

/* a character the font lacks draws as a hollow box the size of a hanzi */
static int advance(uint32_t cp) {
  const lx_glyph *g = glyph(cp);
  return g ? g->adv : 12;
}

int lx_text_width(const char *s) {
  int w = 0;
  while (*s) {
    uint32_t cp;
    s += lx_utf8(s, &cp);
    w += advance(cp);
  }
  return w;
}

static void draw_glyph(lx_px *fb, int x, int y, uint32_t cp, lx_px c) {
  const lx_glyph *g = glyph(cp);
  if (!g) {
    lx_frame(fb, x + 1, y + 2, 10, 10, c);
    return;
  }
  int base = y + lx_font_ascent;
  int top = base - g->yo - g->h;
  int bpr = (g->w + 7) / 8;
  const uint8_t *b = lx_font_bits + g->at;
  for (int r = 0; r < g->h; r++)
    for (int i = 0; i < g->w; i++)
      if (b[r * bpr + i / 8] & (0x80 >> (i % 8))) px(fb, x + g->xo + i, top + r, c);
}

int lx_text(lx_px *fb, int x, int y, const char *s, lx_px c, int maxW) {
  int dots = advance('.') * 3;
  int limit = maxW > 0 ? x + maxW : 1 << 30;
  int fits = maxW <= 0 || lx_text_width(s) <= maxW;
  while (*s) {
    uint32_t cp;
    int n = lx_utf8(s, &cp);
    int a = advance(cp);
    if (!fits && x + a > limit - dots) {
      for (int k = 0; k < 3; k++) {
        draw_glyph(fb, x, y, '.', c);
        x += advance('.');
      }
      return x;
    }
    draw_glyph(fb, x, y, cp, c);
    x += a;
    s += n;
  }
  return x;
}

void lx_text_centre(lx_px *fb, int x, int y, int w, const char *s, lx_px c) {
  int tw = lx_text_width(s);
  lx_text(fb, tw >= w ? x : x + (w - tw) / 2, y, s, c, w);
}

void lx_runs(lx_px *fb, const uint8_t *runs, uint32_t nRuns, int ox, int oy, int dx, int dy, int scale, const lx_px *palette,
             int clipX, int clipY, int clipW, int clipH) {
  for (uint32_t k = 0; k < nRuns; k++) {
    const uint8_t *r = runs + 4 * k;
    int role = r[3];
    if (role == 0) continue;
    lx_px c = palette[role];
    for (int i = 0; i < r[2]; i++) {
      int sx = r[0] + i + dx - ox, sy = r[1] + dy - oy;
      for (int a = 0; a < scale; a++)
        for (int b = 0; b < scale; b++) {
          int X = clipX + sx * scale + b, Y = clipY + sy * scale + a;
          if (X >= clipX && X < clipX + clipW && Y >= clipY && Y < clipY + clipH) px(fb, X, Y, c);
        }
    }
  }
}
