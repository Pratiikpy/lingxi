/* Written by scripts/design-partners.ts; re-run it to reproduce. Do not edit by hand. */

import type { Program, Rule } from "@lingxi/brain";

export interface DesignRecord {
  seed: number;
  generations: number;
  hall: number;
  gates: number;
  train: number;
  test: number;
  program: Program;
  counter: { line: "gentle" | "bold" | "curious"; lessons: Rule[]; wins: number };
  moves: Array<[string, number]>;
}

export const DESIGNED: Readonly<Record<string, DesignRecord>> = {
  baby: {"seed":6699,"style":{"move":"dodge","share":0.4},"generations":50,"hall":4,"gates":41,"train":0.9403,"test":0.9241,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"clean":[3]},"then":{"want":0,"mood":2}},{"when":{"hunger":[1,2]},"then":{"want":1,"mood":2}},{"when":{"event":[0,1],"action":[3,4]},"then":{"want":1,"mood":2}}],"otherwise":{"want":4,"mood":1}},"counter":{"line":"gentle","lessons":[{"when":{"time":[3]},"then":{"want":1,"mood":2}}],"wins":0.9583},"moves":[["dodge",0.442],["tap",0.314],["snack",0.128],["rest",0.116]]},
  child: {"seed":7699,"style":{"move":"pounce","share":0.45},"generations":50,"hall":4,"gates":56,"train":0.8984,"test":0.8346,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"time":[1],"energy":[2],"clean":[3]},"then":{"want":0,"mood":2}},{"when":{"event":[1]},"then":{"want":6,"mood":2}},{"when":{"energy":[0],"joy":[3],"clean":[1]},"then":{"want":1,"mood":2}},{"when":{"action":[4,5],"hunger":[3]},"then":{"want":5,"mood":0}}],"otherwise":{"want":2,"mood":2}},"counter":{"line":"bold","lessons":[{"when":{"hunger":[1,2]},"then":{"want":1,"mood":2}},{"when":{"hunger":[0,1]},"then":{"want":5,"mood":1}}],"wins":1},"moves":[["pounce",0.473],["rest",0.305],["tap",0.184],["snack",0.038]]},
  teen: {"seed":8699,"style":{"move":"charm","share":0.3},"generations":50,"hall":4,"gates":43,"train":0.774,"test":0.8125,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"event":[2],"time":[3]},"then":{"want":5,"mood":3}},{"when":{"time":[1,2],"energy":[1]},"then":{"want":6,"mood":0}},{"when":{"time":[1,2,3],"energy":[3]},"then":{"want":6,"mood":0}},{"when":{"energy":[3],"event":[3]},"then":{"want":2,"mood":0}},{"when":{"energy":[0,1],"time":[2,3]},"then":{"want":1,"mood":2}}],"otherwise":{"want":2,"mood":2}},"counter":{"line":"bold","lessons":[{"when":{"hunger":[2,3]},"then":{"want":5,"mood":1}},{"when":{"action":[5,6]},"then":{"want":1,"mood":3}},{"when":{"hunger":[0]},"then":{"want":2,"mood":3}}],"wins":0.9375},"moves":[["snack",0.314],["charm",0.31],["rest",0.215],["guard",0.084],["pounce",0.063],["tap",0.015]]},
  adult: {"seed":9699,"style":{"move":"guard","share":0.35},"generations":50,"hall":4,"gates":33,"train":0.7857,"test":0.8594,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"event":[3],"joy":[2]},"then":{"want":5,"mood":3}},{"when":{"event":[0]},"then":{"want":0,"mood":3}},{"when":{"event":[0,1],"joy":[0]},"then":{"want":3,"mood":1}},{"when":{"time":[3]},"then":{"want":1,"mood":3}}],"otherwise":{"want":5,"mood":2}},"counter":{"line":"gentle","lessons":[{"when":{"time":[2]},"then":{"want":6,"mood":1}},{"when":{"time":[3]},"then":{"want":0,"mood":0}}],"wins":1},"moves":[["tap",0.553],["guard",0.308],["snack",0.13],["rest",0.009]]},
} as Record<string, DesignRecord>;
