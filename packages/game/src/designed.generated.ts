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
  baby: {"seed":6699,"style":{"move":"dodge","share":0.4},"generations":50,"hall":4,"gates":38,"train":0.9205,"test":0.8899,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"time":[3]},"then":{"want":2,"mood":1}},{"when":{"action":[0,1,2],"time":[2]},"then":{"want":1,"mood":3}},{"when":{"energy":[1],"event":[1,2]},"then":{"want":3,"mood":1}}],"otherwise":{"want":4,"mood":1}},"counter":{"line":"curious","lessons":[{"when":{"action":[2,3,4],"joy":[1,2]},"then":{"want":1,"mood":0}}],"wins":0.9583},"moves":[["dodge",0.432],["rest",0.25],["snack",0.157],["pounce",0.132],["tap",0.029]]},
  child: {"seed":7699,"style":{"move":"pounce","share":0.45},"generations":50,"hall":4,"gates":27,"train":0.8828,"test":0.8646,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"clean":[2,3],"time":[1],"joy":[0,1]},"then":{"want":5,"mood":0}},{"when":{"action":[4,5],"hunger":[2,3]},"then":{"want":5,"mood":0}}],"otherwise":{"want":2,"mood":1}},"counter":{"line":"curious","lessons":[{"when":{"action":[2]},"then":{"want":1,"mood":0}},{"when":{"time":[3]},"then":{"want":5,"mood":0}}],"wins":0.9375},"moves":[["pounce",0.429],["rest",0.288],["guard",0.187],["tap",0.096]]},
  teen: {"seed":8699,"style":{"move":"charm","share":0.3},"generations":50,"hall":4,"gates":25,"train":0.8798,"test":0.9039,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"hunger":[1,2]},"then":{"want":1,"mood":3}},{"when":{"joy":[2],"clean":[3]},"then":{"want":6,"mood":2}},{"when":{"time":[2,3]},"then":{"want":2,"mood":1}},{"when":{},"then":{"want":6,"mood":0}},{"when":{"hunger":[0,1]},"then":{"want":0,"mood":1}}],"otherwise":{"want":0,"mood":1}},"counter":{"line":"gentle","lessons":[{"when":{"energy":[3],"action":[7]},"then":{"want":2,"mood":0}},{"when":{"event":[3]},"then":{"want":6,"mood":1}},{"when":{"hunger":[2,3]},"then":{"want":0,"mood":1}},{"when":{"action":[4,5,6,7]},"then":{"want":1,"mood":3}}],"wins":0.9792},"moves":[["charm",0.306],["rest",0.302],["pounce",0.241],["snack",0.101],["tap",0.05]]},
  adult: {"seed":9699,"style":{"move":"guard","share":0.35},"generations":50,"hall":4,"gates":20,"train":0.9129,"test":0.9063,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"event":[0,1],"time":[2,3]},"then":{"want":1,"mood":1}},{"when":{"action":[0,1]},"then":{"want":0,"mood":3}}],"otherwise":{"want":5,"mood":0}},"counter":{"line":"gentle","lessons":[{"when":{"time":[1]},"then":{"want":6,"mood":1}},{"when":{"time":[3]},"then":{"want":0,"mood":0}}],"wins":0.8021},"moves":[["guard",0.517],["snack",0.344],["tap",0.11],["rest",0.029]]},
} as Record<string, DesignRecord>;
