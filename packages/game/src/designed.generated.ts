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
  baby: {"seed":6699,"style":{"move":"dodge","share":0.4},"generations":50,"hall":4,"gates":38,"train":0.75,"test":0.6682,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"clean":[3],"action":[1,2]},"then":{"want":4,"mood":0}},{"when":{"event":[2],"clean":[2]},"then":{"want":4,"mood":3}},{"when":{"time":[2]},"then":{"want":2,"mood":3}}],"otherwise":{"want":4,"mood":1}},"counter":{"line":"gentle","lessons":[{"when":{"event":[0,1]},"then":{"want":2,"mood":3}}],"wins":0.9792},"moves":[["dodge",0.463],["pounce",0.255],["rest",0.231],["tap",0.051]]},
  child: {"seed":7699,"style":{"move":"pounce","share":0.45},"generations":50,"hall":4,"gates":33,"train":0.8802,"test":0.9987,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"event":[0],"time":[2]},"then":{"want":1,"mood":3}},{"when":{"energy":[2,3],"clean":[1,2],"joy":[2,3],"event":[2,3]},"then":{"want":0,"mood":3}}],"otherwise":{"want":2,"mood":3}},"counter":{"line":"curious","lessons":[{"when":{"energy":[2,3],"joy":[1,2]},"then":{"want":0,"mood":3}},{"when":{"energy":[0,1,2]},"then":{"want":2,"mood":3}}],"wins":0.5625},"moves":[["pounce",0.486],["rest",0.194],["tap",0.183],["snack",0.137]]},
  teen: {"seed":8699,"style":{"move":"charm","share":0.3},"generations":50,"hall":4,"gates":27,"train":0.7981,"test":0.8113,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"time":[2],"event":[0,1]},"then":{"want":6,"mood":0}},{"when":{"joy":[2],"clean":[3]},"then":{"want":6,"mood":0}}],"otherwise":{"want":2,"mood":3}},"counter":{"line":"gentle","lessons":[{"when":{"event":[1],"time":[3]},"then":{"want":5,"mood":2}},{"when":{"time":[2]},"then":{"want":0,"mood":3}},{"when":{"energy":[2]},"then":{"want":1,"mood":3}},{"when":{"hunger":[2]},"then":{"want":5,"mood":2}}],"wins":0.9792},"moves":[["pounce",0.389],["charm",0.304],["rest",0.226],["tap",0.081]]},
  adult: {"seed":9699,"style":{"move":"guard","share":0.35},"generations":50,"hall":4,"gates":77,"train":0.8996,"test":0.9104,"program":{"version":"LX-PET/1","memory":[],"rules":[{"when":{"clean":[3],"energy":[1]},"then":{"want":2,"mood":2}},{"when":{"time":[3],"clean":[0,1]},"then":{"want":1,"mood":3}},{"when":{"joy":[2,3]},"then":{"want":2,"mood":3}},{"when":{"energy":[0]},"then":{"want":2,"mood":2}},{"when":{"event":[1],"energy":[3]},"then":{"want":7,"mood":1}},{"when":{"hunger":[0]},"then":{"want":5,"mood":0}},{"when":{"joy":[2,3],"hunger":[1,2]},"then":{"want":4,"mood":1}},{"when":{"clean":[1,2],"event":[0,1]},"then":{"want":1,"mood":1}}],"otherwise":{"want":2,"mood":3}},"counter":{"line":"bold","lessons":[{"when":{"time":[0,1]},"then":{"want":0,"mood":1}},{"when":{"clean":[0]},"then":{"want":0,"mood":3}},{"when":{"action":[0,1,2]},"then":{"want":2,"mood":3}},{"when":{"energy":[3]},"then":{"want":5,"mood":0}},{"when":{"time":[0]},"then":{"want":7,"mood":0}}],"wins":0.9688},"moves":[["guard",0.318],["pounce",0.288],["snack",0.18],["rest",0.159],["tap",0.055]]},
} as Record<string, DesignRecord>;
