/**
 * Hand-drawn faces. Every expression is drawn pixel by pixel for two face sizes:
 * L for teens and adults (eyes six pixels apart), S for babies and children.
 * They are stamped centred on the face point of each body, so one set of faces
 * serves every pet.
 *
 *   e ink · w shine · b blush · p mouth inside · . leave as is
 */

export const EXPRESSIONS = [
  "neutral",
  "happy",
  "sparkly",
  "sulk",
  "sleepy",
  "yawn",
  "shy",
  "proud",
  "startled",
  "munch",
  "munchShut",
  "sneeze",
  "dizzy",
  "sad",
  "asleep",
  "love",
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

type FaceSet = Record<Expression, readonly string[]>;

export const FACES_L: FaceSet = {
  neutral: [
    "..ew....ew..",
    "..ee....ee..",
    "..ee....ee..",
    "bb........bb",
    "....e..e....",
    ".....ee.....",
  ],
  happy: [
    "............",
    "...e....e...",
    "..e.e..e.e..",
    "bb........bb",
    "....eeee....",
    ".....pp.....",
  ],
  sparkly: [
    "..ew....ew..",
    ".eee....eee.",
    ".eew....eew.",
    ".eee....eee.",
    "bb..e..e..bb",
    ".....ee.....",
  ],
  sulk: [
    "............",
    "..ee....ee..",
    "..ew....ew..",
    "bb........bb",
    "....eeee....",
    "............",
  ],
  sleepy: [
    "............",
    "............",
    "..ee....ee..",
    "bbew....ewbb",
    ".....ee.....",
    "............",
  ],
  yawn: [
    "............",
    "..e......e..",
    "...e....e...",
    "bb...ee...bb",
    "....eppe....",
    ".....ee.....",
  ],
  shy: [
    "............",
    "...ew....ew.",
    "...ee....ee.",
    "bbbb....bbbb",
    "bb...ee...bb",
    "............",
  ],
  proud: [
    "............",
    "..eee..eee..",
    "............",
    "bb........bb",
    "...e....e...",
    "....eeee....",
  ],
  startled: [
    "..ee....ee..",
    ".ewwe..ewwe.",
    ".ewwe..ewwe.",
    "..ee....ee..",
    ".....ee.....",
    ".....ee.....",
  ],
  munch: [
    "............",
    "...e....e...",
    "..e.e..e.e..",
    "bb..eeee..bb",
    "....eppe....",
    ".....ee.....",
  ],
  munchShut: [
    "............",
    "...e....e...",
    "..e.e..e.e..",
    "bb........bb",
    "....e..e....",
    ".....ee.....",
  ],
  sneeze: [
    "............",
    "..e......e..",
    "...ee..ee...",
    "..e......e..",
    "bb..eeee..bb",
    ".....pp.....",
  ],
  dizzy: [
    "..eee..eee..",
    "..e.e..e.e..",
    "..e....e....",
    "............",
    "....e..e....",
    ".....ee.....",
  ],
  sad: [
    "............",
    "..ew....ew..",
    "..ee....ee..",
    "..ww....ww..",
    ".....ee.....",
    "....e..e....",
  ],
  asleep: [
    "............",
    "............",
    "..ee....ee..",
    "bb........bb",
    ".....ee.....",
    "............",
  ],
  love: [
    "............",
    "..w.w..w.w..",
    "..www..www..",
    "...w....w...",
    "....e..e....",
    ".....ee.....",
  ],
};

export const FACES_S: FaceSet = {
  neutral: ["..w....w..", "..e....e..", "b........b", "....ee...."],
  happy: ["..e....e..", ".e.e..e.e.", "b........b", "....ee...."],
  sparkly: [".ew....ew.", ".ee....ee.", "b...ee...b", ".........."],
  sulk: ["..ee..ee..", "..ew..ew..", "b........b", "...eeee..."],
  sleepy: ["..........", "..ee..ee..", "b........b", "....ee...."],
  yawn: [".e......e.", "..e....e..", "b...ee...b", "....pp...."],
  shy: ["...w....w.", "...e....e.", "bbb....bbb", "....ee...."],
  proud: [".ee....ee.", "..........", "b........b", "...e..e...", "....ee...."],
  startled: [".ew....ew.", ".ee....ee.", "....ee....", "....ee...."],
  munch: ["..e....e..", ".e.e..e.e.", "b...ee...b", "....pp...."],
  munchShut: ["..e....e..", ".e.e..e.e.", "b........b", "....ee...."],
  sneeze: [".e......e.", "..ee..ee..", "b...ee...b", ".........."],
  dizzy: [".ee....ee.", ".ee....ee.", "..........", "....ee...."],
  sad: ["..w....w..", "..e....e..", "..w....w..", "...e..e..."],
  asleep: ["..........", ".ee....ee.", "b........b", "....ee...."],
  love: [".w.w..w.w.", "..w....w..", "..........", "....ee...."],
};
