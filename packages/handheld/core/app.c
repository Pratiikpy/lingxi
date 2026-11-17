#include "app.h"
#include "art.h"

/* ── colours: the game's dark theme (apps/web tokens.css) ───────────────── */

#define C_BG 0x18A6    /* #1B1630 */
#define C_CARD 0x20E7  /* #231C3D */
#define C_TINT 0x314B  /* #33295A */
#define C_EDGE 0x39AC  /* #3E3466 */
#define C_INK 0xFF9C   /* #FFF3E2 */
#define C_SOFT 0xCDFD  /* #C9BEEA */
#define C_CORAL 0xFBCB /* #FF7A59 */
#define C_SUNNY 0xFE47 /* #FFC83D */
#define C_SKY 0x6D5F   /* #6FA8FF */
#define C_LEAF 0x7E51  /* #7FCB8E */
#define C_BAD 0xFA69   /* #FF4D4D */

/* ── words, in English and Chinese, as the game says them ───────────────── */

typedef struct {
  const char *en, *zh;
} txt;
#define T(a, b) {a, b}
static const char *tr(const lx_app *a, txt t) { return a->lang ? t.zh : t.en; }

static const txt METER[4] = {T("Full", "饱腹"), T("Happy", "开心"), T("Rested", "精神"), T("Clean", "干净")};
static const txt WANT[8] = {T("rest", "发呆"), T("eat", "吃东西"), T("play", "玩"), T("sleep", "睡觉"), T("explore", "到处看看"), T("sulk", "闹别扭"), T("cuddle", "撒娇"), T("share", "分享")};
static const txt MOOD[4] = {T("grumpy", "不高兴"), T("calm", "平静"), T("happy", "开心"), T("excited", "兴奋")};
static const txt NUDGE[8] = {T("none", "无"), T("brave", "勇敢"), T("curious", "好奇"), T("greedy", "贪吃"), T("calm", "冷静"), T("playful", "爱玩"), T("gentle", "温柔"), T("shy", "害羞")};
static const txt STAGE[6] = {T("egg", "蛋"), T("baby", "宝宝"), T("child", "幼年"), T("teen", "少年"), T("adult", "成年"), T("elder", "长者")};
static const txt NOTE[14] = {
    T("{name} ate it all up.", "{name}吃得一干二净。"),
    T("{name} was already full. A little grumpy now.", "{name}早就饱了，现在有点不高兴。"),
    T("{name} woke up for food.", "{name}为了吃的醒过来了。"),
    T("{name} chased the ball until it got dizzy.", "{name}追着球跑，转得晕乎乎。"),
    T("{name} is too tired to play. Let it rest a while.", "{name}太累了，玩不动。让它歇一会儿吧。"),
    T("{name} isn't feeling well enough to play. Some medicine first?", "{name}不太舒服，玩不了。先吃点药？"),
    T("All clean. {name} sneezed once.", "洗干净啦。{name}打了个喷嚏。"),
    T("Lights off. Good night, {name}.", "关灯了。晚安，{name}。"),
    T("Good morning, {name}.", "早上好，{name}。"),
    T("{name} leans into your hand.", "{name}蹭了蹭你的手。"),
    T("{name} feels better.", "{name}舒服多了。"),
    T("{name} isn't ill, so it pushes the medicine away.", "{name}没生病，把药推开了。"),
    T("{name} is listening.", "{name}在认真听。"),
    T("{name} wakes from a long sleep, a little sulky.", "{name}睡了好久，醒来有点闹脾气。"),
};
static const txt FIELD[8] = {T("hunger", "饿"), T("joy", "心情"), T("energy", "体力"), T("clean", "干净"), T("time", "时间"), T("action", "你做了"), T("around", "周围"), T("owner", "主人")};
static const txt FIELD_VALUE[8][8] = {
    {T("full", "饱"), T("peckish", "有点饿"), T("hungry", "饿"), T("starving", "很饿")},
    {T("sad", "难过"), T("low", "低落"), T("happy", "开心"), T("joyful", "很开心")},
    {T("exhausted", "累坏"), T("tired", "累"), T("fine", "还好"), T("rested", "精神足")},
    {T("filthy", "很脏"), T("dusty", "有点脏"), T("tidy", "干净"), T("spotless", "一尘不染")},
    {T("night", "夜里"), T("morning", "早上"), T("day", "白天"), T("evening", "傍晚")},
    {T("nothing", "无"), T("feed", "喂食"), T("play", "玩耍"), T("clean", "洗澡"), T("lights off", "关灯"), T("pet", "摸摸"), T("medicine", "吃药"), T("talk", "说话")},
    {T("nothing", "无"), T("a friend", "朋友"), T("a toy", "玩具"), T("a fright", "吓人的")},
    {T("away", "不在"), T("here", "在")},
};
static const int FIELD_LO[8] = {0, 2, 4, 6, 8, 10, 13, 15}, FIELD_BITS[8] = {2, 2, 2, 2, 2, 3, 2, 1};

typedef struct {
  const char *id;
  txt name;
} snack_name;
static const snack_name SNACK_NAMES[] = {
    {"mochi", T("Rice mochi", "糯米麻薯")}, {"apple", T("Golden apple", "金苹果")}, {"burger", T("Burger", "汉堡")}, {"sundae", T("Cherry sundae", "樱桃圣代")}};

/* ── small helpers without libc ─────────────────────────────────────────── */

static int slen(const char *s) {
  int n = 0;
  while (s[n]) n++;
  return n;
}
static int seq(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return *a == *b;
}
/* append to a bounded buffer, always NUL-terminated */
static void cat(char *buf, int cap, const char *s) {
  int n = slen(buf);
  while (*s && n < cap - 1) buf[n++] = *s++;
  buf[n] = 0;
}
static void cat_int(char *buf, int cap, int32_t v) {
  char t[12];
  int i = 11;
  t[i] = 0;
  uint32_t u = v < 0 ? (uint32_t)(-(int64_t)v) : (uint32_t)v;
  do t[--i] = (char)('0' + u % 10), u /= 10;
  while (u);
  if (v < 0) t[--i] = '-';
  cat(buf, cap, t + i);
}
static void cat_hex(char *buf, int cap, const uint8_t *b, int n) {
  static const char H[] = "0123456789abcdef";
  char t[3] = {0, 0, 0};
  for (int i = 0; i < n; i++) {
    t[0] = H[b[i] >> 4];
    t[1] = H[b[i] & 15];
    cat(buf, cap, t);
  }
}
/* a template with {name} in it */
static void fill(char *buf, int cap, const char *tpl, const char *name) {
  buf[0] = 0;
  while (*tpl) {
    if (tpl[0] == '{' && tpl[1] == 'n' && tpl[2] == 'a' && tpl[3] == 'm' && tpl[4] == 'e' && tpl[5] == '}') {
      cat(buf, cap, name);
      tpl += 6;
      continue;
    }
    char one[2] = {*tpl++, 0};
    cat(buf, cap, one);
  }
}

/* a tick or a cross, drawn in pixels (the font has neither) */
static void mark(lx_px *fb, int x, int y, int ok, lx_px c) {
  if (ok) {
    static const int8_t T[][2] = {{0, 4}, {1, 5}, {2, 6}, {3, 5}, {4, 4}, {5, 3}, {6, 2}, {7, 1}, {8, 0}};
    for (unsigned i = 0; i < sizeof T / sizeof T[0]; i++) lx_fill(fb, x + T[i][0], y + T[i][1], 2, 2, c);
  } else {
    for (int i = 0; i < 8; i++) {
      lx_fill(fb, x + i, y + i, 2, 2, c);
      lx_fill(fb, x + 7 - i, y + i, 2, 2, c);
    }
  }
}

/* closing punctuation, which never starts a line */
static int closes(uint32_t cp) {
  return cp == 0x3002 || cp == 0xFF0C || cp == 0x3001 || cp == 0x201D || cp == 0x2019 || cp == 0xFF1F || cp == 0xFF01 || cp == 0xFF1B ||
         cp == 0xFF1A || cp == 0x300D || cp == 0x300F || cp == 0xFF09 || cp == '.' || cp == ',' || cp == '!' || cp == '?';
}

/* lines that fit `w`: breaks at a space in Latin text, between any two characters in Chinese */
static int wrap(lx_px *fb, int x, int y, int w, const char *s, lx_px c, int maxLines) {
  int lines = 0;
  while (*s && lines < maxLines) {
    const char *p = s, *cut = 0;
    int width = 0;
    while (*p) {
      uint32_t cp;
      int n = lx_utf8(p, &cp);
      char one[5] = {0};
      for (int i = 0; i < n && i < 4; i++) one[i] = p[i];
      int a = lx_text_width(one);
      if (width + a > w) break;
      width += a;
      p += n;
      if (cp == ' ' || cp >= 0x2E80) cut = p;
    }
    const char *end = !*p ? p : cut && cut > s ? cut : p;
    /* the next line may not begin with closing punctuation: step the break back a character at a time */
    for (int guard = 0; *end && guard < 4; guard++) {
      uint32_t next;
      lx_utf8(end, &next);
      if (!closes(next)) break;
      const char *back = end - 1;
      while (back > s && (*(const uint8_t *)back & 0xC0) == 0x80) back--;
      if (back <= s) break;
      end = back;
    }
    if (end == s) end = s + 1;
    char line[128];
    int n = (int)(end - s) < 127 ? (int)(end - s) : 127;
    for (int i = 0; i < n; i++) line[i] = s[i];
    line[n] = 0;
    if (lines == maxLines - 1 && *end) {
      lx_text(fb, x, y, s, c, w);
    } else lx_text(fb, x, y, line, c, w);
    y += LX_LINE;
    lines++;
    s = end;
    while (*s == ' ') s++;
  }
  return y;
}

/* ── the pet's look: the game's room scene (apps/web RoomScene expressionFor) ── */

static int stage_now(const lx_app *a) {
  if (a->trip.stage == 0) return 0;
  int32_t day = (a->trip.pet.beat - a->trip.bornBeat) / 1440 + 1;
  int s = day >= 31 ? 5 : day >= 8 ? 4 : day >= 4 ? 3 : day >= 2 ? 2 : 1;
  return s > a->trip.stage ? s : a->trip.stage;
}

static int face_now(const lx_app *a, int *lit) {
  const lx_pet *p = &a->trip.pet;
  uint32_t since = a->nowMs - a->careMs;
  int care = a->lastCare && since < 2600 ? a->lastCare : 0;
  *lit = 0;
  if (p->asleep) return LX_FACE_ASLEEP;
  if (p->sick && !care) return LX_FACE_DIZZY;
  *lit = 1;
  if (care == LX_C_FEED) return (a->nowMs / 220) % 2 ? LX_FACE_MUNCH : LX_FACE_MUNCH_SHUT;
  if (care == LX_C_PET) return LX_FACE_LOVE;
  if (care == LX_C_CLEAN) return since < 900 ? LX_FACE_SNEEZE : LX_FACE_HAPPY;
  if (care == LX_C_PLAY) return LX_FACE_HAPPY;
  *lit = 0;
  if (a->nowMs % 4200 < 160) return LX_FACE_ASLEEP; /* a blink */
  if (p->lastWant == LX_W_SULK) return LX_FACE_SULK;
  if (p->lastWant == LX_W_SLEEP) return LX_FACE_SLEEPY;
  if (p->lastWant == LX_W_EAT) return LX_FACE_SAD;
  if (p->lastWant == LX_W_CUDDLE) {
    *lit = 1;
    return LX_FACE_SHY;
  }
  if (p->lastMood == 3) {
    *lit = 1;
    return LX_FACE_SPARKLY;
  }
  if (p->lastMood == 2) return LX_FACE_HAPPY;
  if (p->lastMood == 0) return LX_FACE_SULK;
  return LX_FACE_NEUTRAL;
}

static const lx_layer *layer(int key) {
  for (uint32_t i = 0; i < lx_layer_count; i++)
    if (lx_layers[i].key == key) return &lx_layers[i];
  return 0;
}

static void draw_pet(lx_app *a, lx_px *fb, int bx, int by, int bw, int bh) {
  int line = a->trip.line > 2 ? 0 : a->trip.line;
  int st = stage_now(a);
  int s = st > 4 ? 4 : st;
  int slot = s == 0 ? 0 : 10 * (line + 1) + s;
  const lx_frame_box *fr = 0;
  for (uint32_t i = 0; i < lx_frame_count; i++)
    if (lx_frames[i].slot == slot) fr = &lx_frames[i];
  if (!fr) return;
  int scale = bw / fr->size < bh / fr->size ? bw / fr->size : bh / fr->size;
  if (scale < 1) scale = 1;
  int ox = bx + (bw - fr->size * scale) / 2, oy = by + (bh - fr->size * scale) / 2;
  const uint16_t *pal = s == 0 ? lx_egg_palettes[line] : lx_pet_palettes[line];
  /* a gentle bob while awake, as the game's pets breathe */
  int bob = a->trip.pet.asleep ? 0 : ((a->nowMs / 600) % 2);
  const lx_layer *body = layer(s == 0 ? 0 : 100 + slot);
  if (body) lx_runs(fb, lx_layer_runs + 4 * body->at, body->n, fr->x, fr->y, 0, bob, scale, pal, ox, oy, fr->size * scale, fr->size * scale);
  if (s == 0) return;
  int lit;
  int face = face_now(a, &lit);
  if (lit) {
    const lx_layer *l = layer(200 + slot);
    if (l) lx_runs(fb, lx_layer_runs + 4 * l->at, l->n, fr->x, fr->y, 0, bob, scale, pal, ox, oy, fr->size * scale, fr->size * scale);
  }
  for (uint32_t i = 0; i < lx_anchor_count; i++) {
    const lx_anchor *an = &lx_anchors[i];
    if (an->slot != slot) continue;
    const lx_layer *f = layer(1000 + (an->large ? 16 : 0) + face);
    if (f) lx_runs(fb, lx_layer_runs + 4 * f->at, f->n, fr->x, fr->y, an->at[face][0], an->at[face][1] + bob, scale, pal, ox, oy, fr->size * scale, fr->size * scale);
  }
}

/* ── living ─────────────────────────────────────────────────────────────── */

void lx_app_init(lx_app *a, void *arenaMem, size_t arenaSize, uint8_t *logMem, uint32_t logCap, int platform, uint32_t nowMs) {
  lx_memset(a, 0, sizeof *a);
  lx_arena_init(&a->arena, arenaMem, arenaSize);
  lx_log_init(&a->log, logMem, logCap);
  a->platform = platform;
  a->nowMs = a->bootMs = nowMs;
  lx_selftest_run(&a->st, &a->arena);
  a->screen = a->st.pass ? LX_SCREEN_BOOT : LX_SCREEN_FAILED;
}

lx_err lx_app_open(lx_app *a, const uint8_t *packet, uint32_t len) {
  if (!a->st.pass) return LX_BAD_VALUE;
  if (a->ready) return LX_BAD_VALUE;
  lx_arena_init(&a->arena, a->arena.base, a->arena.size);
  lx_log_init(&a->log, a->log.buf, a->log.cap);
  lx_err e = lx_trip_open(&a->trip, &a->arena, packet, len);
  a->openErr = (int)e;
  if (e) return e;
  a->ready = 1;
  a->lang = a->trip.lang ? 1 : 0;
  a->beatsHere = a->caresHere = 0;
  a->hasNote = 0;
  a->lastCare = 0;
  a->screen = LX_SCREEN_HOME;
  return LX_OK;
}

static void live(lx_app *a) {
  lx_live(&a->trip.pet, a->trip.brain, a->scratch);
  lx_log_live(&a->log);
  a->beatsHere++;
}
static void away(lx_app *a, uint32_t n) {
  lx_away_to(&a->trip.pet, a->trip.brain, a->scratch, a->trip.pet.beat + (int32_t)n);
  lx_log_away(&a->log, n);
  a->beatsHere += n;
}
static int care(lx_app *a, int kind, int arg) {
  const lx_food *food = 0;
  if (kind == LX_C_FEED) {
    if (arg >= a->trip.nSnacks || a->trip.snacks[arg].count == 0) return 0;
    a->trip.snacks[arg].count--;
    food = &a->trip.snacks[arg].food;
  }
  a->note = lx_care(&a->trip.pet, a->trip.brain, a->scratch, kind, food, arg);
  lx_log_care(&a->log, (uint8_t)kind, (uint8_t)arg);
  a->hasNote = 1;
  a->noteMs = a->nowMs;
  a->lastCare = kind;
  a->careMs = a->nowMs;
  a->caresHere++;
  return 1;
}

lx_err lx_app_resume(lx_app *a, const uint8_t *packet, uint32_t len, const uint8_t *ops, uint32_t opsLen) {
  lx_err e = lx_app_open(a, packet, len);
  if (e) return e;
  uint32_t p = 0;
  while (p < opsLen) {
    uint8_t op = ops[p];
    if (op == LX_OP_LIVE && p + 3 <= opsLen) {
      uint32_t n = ops[p + 1] | (ops[p + 2] << 8);
      for (uint32_t i = 0; i < n; i++) live(a);
      p += 3;
    } else if (op == LX_OP_AWAY && p + 5 <= opsLen) {
      uint32_t n = ops[p + 1] | (ops[p + 2] << 8) | ((uint32_t)ops[p + 3] << 16) | ((uint32_t)ops[p + 4] << 24);
      away(a, n);
      p += 5;
    } else if (op == LX_OP_CARE && p + 3 <= opsLen) {
      care(a, ops[p + 1], ops[p + 2]);
      p += 3;
    } else {
      lx_app_release(a);
      return LX_BAD_VALUE;
    }
  }
  a->hasNote = 0;
  a->lastCare = 0;
  return LX_OK;
}

void lx_app_tick(lx_app *a, uint32_t nowMs, int32_t wallBeat, int present) {
  a->nowMs = nowMs;
  a->present = present;
  if (a->screen == LX_SCREEN_BOOT && nowMs - a->bootMs > 1600) a->screen = a->ready ? LX_SCREEN_HOME : LX_SCREEN_EMPTY;
  if (a->screen == LX_SCREEN_PLAY && a->playDone && nowMs - a->playStopMs > 900) {
    care(a, LX_C_PLAY, a->playStars);
    a->screen = LX_SCREEN_HOME;
  }
  if (!a->ready || a->screen == LX_SCREEN_LEAVE) return;
  int32_t gap = wallBeat - a->trip.pet.beat;
  if (gap <= 0) return;
  /* time with the handheld put down is lived as time away; the beat it is picked up in, with its owner */
  if (present) {
    if (gap > 1) away(a, (uint32_t)(gap - 1));
    live(a);
  } else away(a, (uint32_t)gap);
}

/* ── keys ───────────────────────────────────────────────────────────────── */

static int snacks_left(const lx_app *a) {
  int n = 0;
  for (int i = 0; i < a->trip.nSnacks; i++) n += a->trip.snacks[i].count > 0;
  return n;
}

void lx_app_key(lx_app *a, int key) {
  if (key == 'z') {
    a->lang = !a->lang;
    return;
  }
  if (a->screen == LX_SCREEN_BOOT) {
    a->screen = a->ready ? LX_SCREEN_HOME : LX_SCREEN_EMPTY;
    return;
  }
  if (!a->ready) return;
  switch (a->screen) {
    case LX_SCREEN_HOME:
      if (key == 'f') {
        if (snacks_left(a) == 0) {
          a->hasNote = 2;
          a->noteMs = a->nowMs;
        } else if (snacks_left(a) == 1) {
          for (int i = 0; i < a->trip.nSnacks; i++)
            if (a->trip.snacks[i].count) care(a, LX_C_FEED, i);
        } else a->screen = LX_SCREEN_SNACKS;
      } else if (key == 'p') {
        const lx_pet *p = &a->trip.pet;
        if (p->sick || p->meters[LX_ENERGY] / LX_SUB < 120) care(a, LX_C_PLAY, 0);
        else {
          a->screen = LX_SCREEN_PLAY;
          a->playStartMs = a->nowMs;
          a->playDone = 0;
        }
      } else if (key == 'c') care(a, LX_C_CLEAN, 0);
      else if (key == 'l') care(a, a->trip.pet.asleep ? LX_C_WAKE : LX_C_LIGHTS, 0);
      else if (key == 'h') care(a, LX_C_PET, 0);
      else if (key == 'm') care(a, LX_C_MEDICINE, 0);
      else if (key == 't') care(a, LX_C_TALK, 0);
      else if (key == 'b') a->screen = LX_SCREEN_BRAIN;
      else if (key == 'g') a->screen = LX_SCREEN_LEAVE;
      else if (key == '?' || key == '/') a->screen = LX_SCREEN_HELP;
      break;
    case LX_SCREEN_SNACKS:
      if (key >= '1' && key <= '4') {
        int i = key - '1';
        if (i < a->trip.nSnacks && a->trip.snacks[i].count) {
          care(a, LX_C_FEED, i);
          a->screen = LX_SCREEN_HOME;
        }
      } else if (key == LX_KEY_ESC || key == LX_KEY_DEL || key == '`') a->screen = LX_SCREEN_HOME;
      break;
    case LX_SCREEN_PLAY:
      if (!a->playDone && (key == LX_KEY_SPACE || key == LX_KEY_ENTER || key == 'p')) {
        uint32_t t = (a->nowMs - a->playStartMs) % 1400;
        int pos = t < 700 ? (int)(t * 200 / 700) : (int)((1400 - t) * 200 / 700);
        int d = pos > 100 ? pos - 100 : 100 - pos;
        a->playStars = d <= 8 ? 3 : d <= 20 ? 2 : d <= 40 ? 1 : 0;
        a->playDone = 1;
        a->playStopMs = a->nowMs;
      }
      break;
    default:
      if (key == LX_KEY_ESC || key == LX_KEY_DEL || key == '`' || key == 'b' || key == '?' || key == LX_KEY_ENTER) a->screen = LX_SCREEN_HOME;
      break;
  }
}

uint32_t lx_app_close(lx_app *a, uint8_t *out, uint32_t cap) {
  if (!a->ready) return 0;
  return lx_trip_close(&a->trip, &a->log, out, cap);
}

void lx_app_release(lx_app *a) {
  a->ready = 0;
  a->screen = LX_SCREEN_EMPTY;
  lx_arena_init(&a->arena, a->arena.base, a->arena.size);
  lx_log_init(&a->log, a->log.buf, a->log.cap);
}

/* ── drawing ────────────────────────────────────────────────────────────── */

static void top_bar(lx_app *a, lx_px *fb) {
  lx_fill(fb, 0, 0, LX_W, 16, C_CARD);
  lx_fill(fb, 0, 16, LX_W, 1, C_EDGE);
  lx_px nameC = a->trip.colour >= 1 && a->trip.colour <= 8 ? lx_name_colours[a->trip.colour] : C_INK;
  lx_text(fb, 4, 1, a->trip.name, nameC, 92);
  char buf[64] = {0};
  int32_t day = (a->trip.pet.beat - a->trip.bornBeat) / 1440 + 1;
  cat(buf, sizeof buf, tr(a, STAGE[stage_now(a)]));
  cat(buf, sizeof buf, a->lang ? " · 第 " : " · day ");
  cat_int(buf, sizeof buf, day);
  if (a->lang) cat(buf, sizeof buf, " 天");
  lx_text(fb, 100, 1, buf, C_SOFT, 92);
  int h = lx_local_hour(&a->trip.pet, a->trip.pet.beat);
  int m = ((a->trip.pet.beat + a->trip.pet.tzOffsetMin) % 60 + 60) % 60;
  char clock[8] = {0};
  if (h < 10) cat(clock, sizeof clock, "0");
  cat_int(clock, sizeof clock, h);
  cat(clock, sizeof clock, ":");
  if (m < 10) cat(clock, sizeof clock, "0");
  cat_int(clock, sizeof clock, m);
  lx_text(fb, LX_W - 4 - lx_text_width(clock), 1, clock, C_INK, 0);
}

static void bottom_hint(lx_app *a, lx_px *fb, const char *en, const char *zh) {
  lx_fill(fb, 0, LX_H - 15, LX_W, 15, C_CARD);
  lx_fill(fb, 0, LX_H - 16, LX_W, 1, C_EDGE);
  lx_text(fb, 4, LX_H - 15, a->lang ? zh : en, C_SOFT, LX_W - 8);
}

static void meter(lx_px *fb, int x, int y, const char *label, int32_t internal, lx_px c) {
  int v = internal / LX_SUB;
  lx_text(fb, x, y, label, C_SOFT, 44);
  lx_box(fb, x + 46, y + 4, 72, 8, C_TINT, C_EDGE);
  lx_fill(fb, x + 47, y + 5, v * 70 / 1000, 6, v < 250 ? C_BAD : c);
}

static void draw_home(lx_app *a, lx_px *fb) {
  top_bar(a, fb);
  lx_box(fb, 2, 19, 104, 100, C_TINT, C_EDGE);
  lx_fill(fb, 3, 100, 102, 1, C_EDGE);
  draw_pet(a, fb, 4, 21, 100, 96);
  const lx_pet *p = &a->trip.pet;
  static const lx_px MC[4] = {C_CORAL, C_SUNNY, C_SKY, C_LEAF};
  for (int i = 0; i < 4; i++) meter(fb, 112, 19 + 13 * i, tr(a, METER[i]), p->meters[i], MC[i]);
  int y = 19 + 13 * 4 + 2;
  if (a->hasNote && a->nowMs - a->noteMs < 6000) {
    /* what just happened takes the thinking line's place for a few seconds */
    char buf[200];
    if (a->hasNote == 2) fill(buf, sizeof buf, a->lang ? "零食吃完了。带{name}回家吃吧。" : "No snacks left. Bring {name} home to eat.", a->trip.name);
    else fill(buf, sizeof buf, tr(a, NOTE[a->note]), a->trip.name);
    wrap(fb, 112, y, LX_W - 116, buf, C_INK, 3);
  } else {
    if (p->asleep || p->hibernating) {
      lx_text(fb, 112, y, a->lang ? (p->hibernating ? "冬眠中……" : "睡着了 Zzz") : (p->hibernating ? "hibernating…" : "asleep Zzz"), C_SKY, 124);
    } else {
      int x = lx_text(fb, 112, y, a->lang ? "在想 " : "thinking ", C_SOFT, 0);
      const char *w = tr(a, WANT[p->lastWant & 7]);
      int tw = lx_text_width(w);
      lx_box(fb, x, y + 1, tw + 8, 13, lx_want_colours[p->lastWant & 7], lx_want_colours[p->lastWant & 7]);
      lx_text(fb, x + 4, y, w, C_BG, 0);
    }
    if (p->sick) lx_text(fb, 112, y + LX_LINE, a->lang ? "生病了" : "unwell", C_BAD, 0);
    else if (!p->asleep && !p->hibernating) lx_text(fb, 112, y + LX_LINE, tr(a, MOOD[p->lastMood & 3]), C_SOFT, 0);
  }
  int cycle = (a->nowMs / 3500) % 2;
  if (cycle == 0) bottom_hint(a, fb, "F feed  P play  C clean  L sleep  H pet", "F喂食 P玩耍 C洗澡 L睡觉 H摸摸");
  else bottom_hint(a, fb, "M medicine  T talk  B brain  G home  ?", "M吃药 T说话 B电路 G回家 ?帮助");
}

static void draw_snacks(lx_app *a, lx_px *fb) {
  top_bar(a, fb);
  lx_text(fb, 8, 22, a->lang ? "吃哪个？" : "Which snack?", C_INK, 0);
  for (int i = 0; i < a->trip.nSnacks; i++) {
    const lx_snack *s = &a->trip.snacks[i];
    int y = 42 + i * 18;
    lx_box(fb, 6, y, LX_W - 12, 16, s->count ? C_CARD : C_BG, C_EDGE);
    char buf[64] = {0};
    char k[2] = {(char)('1' + i), 0};
    cat(buf, sizeof buf, k);
    cat(buf, sizeof buf, "  ");
    const char *name = s->id;
    for (unsigned j = 0; j < sizeof SNACK_NAMES / sizeof SNACK_NAMES[0]; j++)
      if (seq(SNACK_NAMES[j].id, s->id)) name = tr(a, SNACK_NAMES[j].name);
    cat(buf, sizeof buf, name);
    lx_text(fb, 12, y + 1, buf, s->count ? C_INK : C_SOFT, 160);
    char n[12] = "×";
    cat_int(n, sizeof n, s->count);
    lx_text(fb, LX_W - 14 - lx_text_width(n), y + 1, n, C_SUNNY, 0);
  }
  bottom_hint(a, fb, "1-4 choose  ` back", "1-4 选择  ` 返回");
}

static void draw_play(lx_app *a, lx_px *fb) {
  top_bar(a, fb);
  lx_text_centre(fb, 0, 24, LX_W, a->lang ? "把球停在正中间" : "Stop the ball in the middle", C_INK);
  int x0 = 20, w = 200, y = 64;
  lx_box(fb, x0 - 4, y - 8, w + 8, 24, C_TINT, C_EDGE);
  lx_fill(fb, x0 + 100 - 8, y - 6, 17, 20, C_EDGE);
  lx_fill(fb, x0 + 100 - 1, y - 6, 3, 20, C_SUNNY);
  uint32_t t = ((a->playDone ? a->playStopMs : a->nowMs) - a->playStartMs) % 1400;
  int pos = t < 700 ? (int)(t * 200 / 700) : (int)((1400 - t) * 200 / 700);
  lx_box(fb, x0 + pos - 5, y - 3, 11, 11, C_CORAL, C_INK);
  if (a->playDone) {
    char s[32] = {0};
    for (int i = 0; i < 3; i++) cat(s, sizeof s, i < a->playStars ? "★" : "☆");
    lx_text_centre(fb, 0, 92, LX_W, s, C_SUNNY);
  }
  bottom_hint(a, fb, "space  stop the ball", "空格  停住球");
}

static void lamp(lx_px *fb, int x, int y, int on, lx_px c) { lx_box(fb, x, y, 7, 7, on ? c : C_TINT, on ? c : C_EDGE); }

static void draw_brain(lx_app *a, lx_px *fb) {
  top_bar(a, fb);
  const lx_pet *p = &a->trip.pet;
  char buf[96] = {0};
  cat(buf, sizeof buf, a->lang ? "电路 · " : "circuit · ");
  cat_int(buf, sizeof buf, (int32_t)a->trip.brain->nGates);
  cat(buf, sizeof buf, a->lang ? " 门 · " : " gates · ");
  cat_int(buf, sizeof buf, (int32_t)a->trip.brain->nState);
  cat(buf, sizeof buf, a->lang ? " 记忆位" : " memory bits");
  lx_text(fb, 4, 18, buf, C_INK, LX_W - 8);
  uint16_t w = p->lastWord;
  /* the 16 input pins, field by field, with what each reads */
  for (int f = 0; f < 8; f++) {
    int col = f / 4, row = f % 4;
    int x = 4 + col * 118, y = 34 + row * 14;
    int v = (w >> FIELD_LO[f]) & ((1 << FIELD_BITS[f]) - 1);
    for (int b = 0; b < FIELD_BITS[f]; b++) lamp(fb, x + b * 8, y + 4, (w >> (FIELD_LO[f] + FIELD_BITS[f] - 1 - b)) & 1, C_SUNNY);
    char t[48] = {0};
    cat(t, sizeof t, tr(a, FIELD[f]));
    cat(t, sizeof t, " ");
    cat(t, sizeof t, tr(a, FIELD_VALUE[f][v]));
    lx_text(fb, x + 26, y, t, C_SOFT, 90);
  }
  int y = 34 + 4 * 14 + 2;
  char o[96] = {0};
  cat(o, sizeof o, a->lang ? "→ 想" : "→ wants ");
  cat(o, sizeof o, tr(a, WANT[p->lastWant & 7]));
  cat(o, sizeof o, a->lang ? " · 心情" : " · mood ");
  cat(o, sizeof o, tr(a, MOOD[p->lastMood & 3]));
  if (p->lastNudge) {
    cat(o, sizeof o, a->lang ? " · 变得更" : " · grows ");
    cat(o, sizeof o, tr(a, NUDGE[p->lastNudge & 7]));
  }
  lx_text(fb, 4, y, o, lx_want_colours[p->lastWant & 7], LX_W - 8);
  /* memory, one lamp per latch */
  int n = (int)p->nBrain;
  for (int i = 0; i < n && i < 56; i++) lamp(fb, 4 + (i % 28) * 8, y + 16 + (i / 28) * 8, p->brain[i], C_LEAF);
  char h[64] = {0};
  cat(h, sizeof h, a->lang ? "日志 0x" : "log 0x");
  cat_hex(h, sizeof h, p->logHash, 4);
  cat(h, sizeof h, "… · ");
  cat_int(h, sizeof h, (int32_t)p->logLength);
  cat(h, sizeof h, a->lang ? " 个词" : " words");
  bottom_hint(a, fb, h, h);
}

static void draw_leave(lx_app *a, lx_px *fb) {
  top_bar(a, fb);
  char buf[160];
  fill(buf, sizeof buf, a->lang ? "带{name}回家" : "Take {name} home", a->trip.name);
  lx_text(fb, 6, 22, buf, C_INK, LX_W - 12);
  char s[96] = {0};
  cat_int(s, sizeof s, (int32_t)a->beatsHere);
  cat(s, sizeof s, a->lang ? " 分钟在这里，照顾了 " : " minutes here, cared for ");
  cat_int(s, sizeof s, (int32_t)a->caresHere);
  cat(s, sizeof s, a->lang ? " 次" : " times");
  lx_text(fb, 6, 40, s, C_SOFT, LX_W - 12);
  char h[64] = {0};
  cat(h, sizeof h, a->lang ? "日志结尾 0x" : "its log ends 0x");
  cat_hex(h, sizeof h, a->trip.pet.logHash, 6);
  cat(h, sizeof h, "…");
  lx_text(fb, 6, 54, h, C_SOFT, LX_W - 12);
  const char *how = a->platform == LX_PLATFORM_DEVICE
                        ? (a->lang ? "插上数据线，在游戏里选“带回家”。游戏会把这一路重放一遍，一致才接回来。" : "Plug in the cable and choose Bring home in the game. It replays the whole trip and takes the pet back only if it matches.")
                        : (a->lang ? "在下面按“带回家”。游戏会把这一路重放一遍，一致才接回来。" : "Press Bring home below. The game replays the whole trip and takes the pet back only if it matches.");
  wrap(fb, 6, 72, LX_W - 12, how, C_INK, 3);
  bottom_hint(a, fb, "` back", "` 返回");
}

static void draw_help(lx_app *a, lx_px *fb) {
  top_bar(a, fb);
  static const txt rows[] = {T("F feed (choose a snack)", "F 喂食（选零食）"), T("P play: stop the ball in the middle", "P 玩耍：把球停在中间"),
                             T("C clean   L lights off / wake", "C 洗澡   L 关灯 / 叫醒"), T("H pet   M medicine   T talk", "H 摸摸   M 吃药   T 说话"),
                             T("B its circuit   G go home   Z 中文", "B 它的电路   G 回家   Z English")};
  for (unsigned i = 0; i < sizeof rows / sizeof rows[0]; i++) lx_text(fb, 6, 22 + 15 * i, tr(a, rows[i]), C_INK, LX_W - 12);
  bottom_hint(a, fb, "` back", "` 返回");
}

static void draw_boot(lx_app *a, lx_px *fb, int failed) {
  lx_fill(fb, 0, 0, LX_W, LX_H, C_BG);
  lx_text_centre(fb, 0, 10, LX_W, "Lingxi 灵犀", C_CORAL);
  lx_text_centre(fb, 0, 26, LX_W, a->lang ? "心智是真电路的宠物" : "a pet whose mind is a real circuit", C_SOFT);
  const lx_selftest *s = &a->st;
  static const char *names[3] = {"gentle #1", "bold #2", "curious #3"};
  for (int i = 0; i < 3; i++) {
    char t[64] = {0};
    int ok = s->hashOk[i] && s->loadOk[i];
    cat(t, sizeof t, names[i]);
    cat(t, sizeof t, a->lang ? " 网表与链上一致" : " matches X Layer");
    mark(fb, 10, 49 + 14 * i, ok, ok ? C_LEAF : C_BAD);
    lx_text(fb, 24, 46 + 14 * i, t, ok ? C_LEAF : C_BAD, LX_W - 30);
  }
  char t[64] = {0};
  int ok1 = s->pet1HashOk && s->pet1MemoryOk;
  cat(t, sizeof t, a->lang ? "1 号宠物的主网日志重放一致" : "pet #1's mainnet log replays");
  mark(fb, 10, 91, ok1, ok1 ? C_LEAF : C_BAD);
  lx_text(fb, 24, 88, t, ok1 ? C_LEAF : C_BAD, LX_W - 30);
  if (failed) lx_text_centre(fb, 0, 108, LX_W, a->lang ? "自检没通过，不接收宠物。" : "Self-test failed: no pet can come here.", C_BAD);
}

static void draw_empty(lx_app *a, lx_px *fb) {
  lx_fill(fb, 0, 0, LX_W, LX_H, C_BG);
  lx_text_centre(fb, 0, 14, LX_W, "Lingxi 灵犀", C_CORAL);
  wrap(fb, 12, 40, LX_W - 24,
       a->lang ? "这里还没有宠物。在游戏里打开“宠物”，选“带出门”。" : "No pet here yet. In the game, open Pet and choose Take along.", C_INK, 3);
  const char *st = a->st.pass ? (a->lang ? "自检通过" : "self-test passed") : (a->lang ? "自检没通过" : "self-test failed");
  int sx = (LX_W - lx_text_width(st) - 14) / 2;
  mark(fb, sx, 99, a->st.pass, a->st.pass ? C_LEAF : C_BAD);
  lx_text(fb, sx + 14, 96, st, a->st.pass ? C_LEAF : C_BAD, 0);
  bottom_hint(a, fb, "Z 中文", "Z English");
}

void lx_app_draw(lx_app *a, lx_px *fb) {
  lx_fill(fb, 0, 0, LX_W, LX_H, C_BG);
  switch (a->screen) {
    case LX_SCREEN_BOOT: draw_boot(a, fb, 0); break;
    case LX_SCREEN_FAILED: draw_boot(a, fb, 1); break;
    case LX_SCREEN_EMPTY: draw_empty(a, fb); break;
    case LX_SCREEN_HOME: draw_home(a, fb); break;
    case LX_SCREEN_SNACKS: draw_snacks(a, fb); break;
    case LX_SCREEN_PLAY: draw_play(a, fb); break;
    case LX_SCREEN_BRAIN: draw_brain(a, fb); break;
    case LX_SCREEN_LEAVE: draw_leave(a, fb); break;
    case LX_SCREEN_HELP: draw_help(a, fb); break;
  }
}
