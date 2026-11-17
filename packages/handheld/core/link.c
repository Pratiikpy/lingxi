#include "link.h"

static const char HEX[] = "0123456789abcdef";

void lx_link_init(lx_link *l, uint8_t *packetBuf, uint32_t packetCap, uint8_t *outBuf, uint32_t outCap, lx_link_write write, void *ctx) {
  lx_memset(l, 0, sizeof *l);
  l->packet = packetBuf;
  l->cap = packetCap;
  l->out = outBuf;
  l->outCap = outCap;
  l->write = write;
  l->ctx = ctx;
}

static uint32_t slen(const char *s) {
  uint32_t n = 0;
  while (s[n]) n++;
  return n;
}
static void say(lx_link *l, const char *s) { l->write(l->ctx, (const uint8_t *)s, slen(s)); }

static void num(char *dst, uint32_t v) {
  char t[11];
  int n = 0;
  do t[n++] = (char)('0' + v % 10); while ((v /= 10) && n < 10);
  for (int i = 0; i < n; i++) dst[i] = t[n - 1 - i];
  dst[n] = 0;
}

static void err(lx_link *l, uint32_t code, const char *word) {
  char line[48] = "LXERR ";
  num(line + 6, code);
  uint32_t n = slen(line);
  line[n++] = ' ';
  for (uint32_t i = 0; word[i] && n < sizeof line - 2; i++) line[n++] = word[i];
  line[n++] = '\n';
  l->write(l->ctx, (const uint8_t *)line, n);
}

static const char *open_word(lx_err e) {
  switch (e) {
    case LX_BAD_MAGIC: return "notATrip";
    case LX_BAD_VERSION: return "version";
    case LX_BAD_CHECK: return "damaged";
    case LX_BAD_HASH: return "brainHash";
    case LX_NO_ROOM: return "noRoom";
    case LX_TRUNCATED: return "truncated";
    default: return "badBrain";
  }
}

static int is(const lx_link *l, const char *s) {
  uint32_t i = 0;
  for (; s[i]; i++)
    if (i >= l->cmdLen || l->cmd[i] != s[i]) return 0;
  return i == l->cmdLen;
}

/* the packet back, written as hex in short runs so no whole line is ever held */
static void send_back(lx_link *l, lx_app *app) {
  uint32_t n = lx_app_close(app, l->out, l->outCap);
  if (!n) return err(l, LX_LINK_TOO_LONG, "tooLong");
  say(l, "LXBACK ");
  char run[128];
  uint32_t r = 0;
  for (uint32_t i = 0; i < n; i++) {
    run[r++] = HEX[l->out[i] >> 4];
    run[r++] = HEX[l->out[i] & 15];
    if (r == sizeof run) {
      l->write(l->ctx, (const uint8_t *)run, r);
      r = 0;
    }
  }
  run[r++] = '\n';
  l->write(l->ctx, (const uint8_t *)run, r);
}

static void end_line(lx_link *l, lx_app *app, uint32_t nowMs) {
  if (l->overlong) err(l, LX_LINK_UNKNOWN, "unknown");
  else if (is(l, "LX?")) {
    char line[24] = "LX! ";
    num(line + 4, LX_LINK_VERSION);
    uint32_t n = slen(line);
    line[n++] = ' ';
    line[n++] = app->st.pass ? '1' : '0';
    line[n++] = ' ';
    line[n++] = app->ready ? '1' : '0';
    line[n++] = '\n';
    l->write(l->ctx, (const uint8_t *)line, n);
  } else if (is(l, "LXPUT")) {
    if (!app->st.pass) err(l, LX_LINK_NO_TEST, "selfTest");
    else if (app->ready) err(l, LX_LINK_BUSY, "busy");
    else if (l->argErr) err(l, l->argErr, l->argErr == LX_LINK_TOO_BIG ? "tooBig" : "badHex");
    else if (l->half || !l->len) err(l, LX_LINK_BAD_HEX, "badHex");
    else {
      lx_err e = lx_app_open(app, l->packet, l->len);
      if (e) err(l, (uint32_t)e, open_word(e));
      else {
        l->held = l->len;
        l->changed = 1;
        say(l, "LXOK put\n");
      }
    }
  } else if (is(l, "LXGET")) {
    if (!app->ready) err(l, LX_LINK_EMPTY, "empty");
    else send_back(l, app);
  } else if (is(l, "LXDONE") || is(l, "LXDROP")) {
    if (!app->ready) err(l, LX_LINK_EMPTY, "empty");
    else {
      lx_app_release(app);
      l->changed = 1;
      say(l, l->cmd[2] == 'D' && l->cmd[3] == 'O' ? "LXOK done\n" : "LXOK drop\n");
    }
  } else if (is(l, "LXTIME")) {
    int32_t beat = (int32_t)l->number;
    /* an earlier time than the handheld's own count is taken too: it corrects a clock that ran fast, and the pet
       never lives backwards (a tick with no time to live does nothing) */
    if (l->argErr || !l->digits || l->number > 0x7fffffffu) err(l, LX_LINK_BAD_TIME, "badTime");
    else {
      l->haveTime = 1;
      l->timeBeat = beat;
      l->timeAtMs = nowMs;
      /* the pet catches up to the time just given, so what LXGET sends next is current */
      lx_app_tick(app, nowMs, beat, 1);
      say(l, "LXOK time\n");
    }
  } else if (l->cmdLen) err(l, LX_LINK_UNKNOWN, "unknown");
  l->cmdLen = 0;
  l->inArg = 0;
  l->overlong = 0;
  l->len = 0;
  l->half = 0;
  l->number = 0;
  l->digits = 0;
  l->argErr = LX_LINK_OK;
}

static int hexval(uint8_t c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

void lx_link_byte(lx_link *l, lx_app *app, uint8_t b, uint32_t nowMs) {
  if (b == '\n') return end_line(l, app, nowMs);
  if (b == '\r') return;
  if (!l->inArg) {
    if (b == ' ') {
      l->inArg = 1;
      return;
    }
    if (l->cmdLen < LX_LINK_CMD_MAX) l->cmd[l->cmdLen++] = (char)b;
    else l->overlong = 1;
    return;
  }
  if (l->argErr) return;
  /* LXTIME takes a decimal number */
  if (is(l, "LXTIME")) {
    if (b < '0' || b > '9' || l->digits >= 10) l->argErr = LX_LINK_BAD_TIME;
    else {
      l->number = l->number * 10 + (uint32_t)(b - '0');
      l->digits++;
    }
    return;
  }
  /* LXPUT's argument is hex */
  int v = hexval(b);
  if (v < 0) {
    l->argErr = LX_LINK_BAD_HEX;
    return;
  }
  if (!l->half) {
    l->nibble = v;
    l->half = 1;
    return;
  }
  l->half = 0;
  if (l->len >= l->cap) {
    l->argErr = LX_LINK_TOO_BIG;
    return;
  }
  l->packet[l->len++] = (uint8_t)(l->nibble << 4 | v);
}

int32_t lx_link_wall_beat(const lx_link *l, uint32_t nowMs) {
  if (!l->haveTime) return -1;
  return l->timeBeat + (int32_t)((nowMs - l->timeAtMs) / 60000u);
}

int lx_link_take_changed(lx_link *l) {
  int c = l->changed;
  l->changed = 0;
  return c;
}
