/**
 * What Lingxi's MCP tools do (plan H7, TAP-15). Each returns an MCP tool result: a short text a model can read, and
 * `structuredContent` with the same facts as data. Arguments that break a tool's input schema throw ToolArgsError (the
 * server answers -32602); a well-formed call the game refuses (an unknown pet, a lesson a pet cannot hold) is a tool
 * result with `isError: true`, so a model can read why and try again.
 */

import type { PublicClient } from "viem";
import {
  INPUT_FIELDS,
  MOODS,
  NUDGES,
  type Program,
  type Rule,
  WANTS,
  compileProgram,
  decodeOutput,
  decodeSenses,
  fastBrain,
  gateCount,
  validateProgram,
} from "@lingxi/brain";
import type { Deployment } from "@lingxi/chain";
import { LESSON_CAPACITY, MAX_GATES, checkLesson, composeProgram } from "@lingxi/game";
import { petView, runSpar } from "./agentApi";
import { RateLimiter } from "./limit";
import type { McpToolName } from "./mcpToolDefs";

export class ToolArgsError extends Error {}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDeps {
  chain?: { pub: PublicClient; deployment: Deployment };
  /** proposals across every caller: each reads 65,536 situations twice (about 0.1 s on the shared event loop) */
  proposals?: RateLimiter;
}

/** At most this many proposals a minute from everyone together, so no crowd can hold the game's server. */
export const PROPOSALS_PER_MINUTE = 60;
const sharedProposals = new RateLimiter(PROPOSALS_PER_MINUTE, 60_000);

const LINES = ["gentle", "bold", "curious"] as const;
type Line = (typeof LINES)[number];
/** How many changed situations a proposal shows as examples. */
const EXAMPLES = 3;

const text = (t: string, data?: Record<string, unknown>, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(data ? { structuredContent: data } : {}),
  ...(isError ? { isError: true } : {}),
});
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const only = (args: Record<string, unknown>, allowed: readonly string[]) => {
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length) throw new ToolArgsError(`unknown argument ${extra[0]}; this tool takes ${allowed.join(", ")}`);
};

async function readPetTool(args: Record<string, unknown>, deps: ToolDeps): Promise<ToolResult> {
  only(args, ["id"]);
  if (typeof args.id !== "string" || !/^[1-9]\d{0,8}$/.test(args.id))
    throw new ToolArgsError('id must be a pet number written as a string, for example "1"');
  if (!deps.chain) throw new Error("unavailable");
  const r = await petView(deps.chain, args.id);
  if (r.status === 404) return text(`There is no pet #${args.id} on X Layer.`, { found: false, id: args.id }, true);
  const b = r.body as {
    name: string;
    line: string;
    owner: string;
    brainId: string;
    processor: string;
    day: number;
    born: number;
    parents: string[];
    proof: string;
    logHash: string;
  };
  const parents = b.parents.length ? ` Its parents are pets #${b.parents.join(" and #")}.` : "";
  const born = new Date(b.born * 1000).toISOString().slice(0, 10);
  const { ok: _ok, image: _image, ...data } = r.body;
  return text(
    `${b.name || `Pet #${args.id}`} is a ${b.line} pet, owned by ${b.owner}, born ${born}, on day ${b.day}. Its mind is circuit #${b.brainId} on processor ${b.processor}; its log hash is ${b.logHash}.${parents} Proof page: ${b.proof}`,
    { found: true, ...data },
  );
}

function runSparTool(args: Record<string, unknown>): ToolResult {
  only(args, ["program", "chips", "vs", "seed"]);
  for (const k of ["program", "chips", "vs"])
    if (args[k] !== undefined && typeof args[k] !== "string") throw new ToolArgsError(`${k} must be a string`);
  if (typeof args.vs !== "string" || !args.vs)
    throw new ToolArgsError("vs is required: a partner id such as pip, or fly:<rival id>");
  if (
    args.seed !== undefined &&
    !(Number.isSafeInteger(args.seed) && (args.seed as number) >= 0 && (args.seed as number) < 2 ** 32)
  )
    throw new ToolArgsError("seed must be a whole number from 0 to 4294967295");
  if (args.program === undefined && args.chips === undefined)
    throw new ToolArgsError("give a brain: program (lx1....) or chips");
  const r = runSpar({
    program: args.program as string | undefined,
    chips: args.chips as string | undefined,
    vs: args.vs,
    seed: args.seed === undefined ? undefined : String(args.seed),
  });
  if (r.status !== 200)
    return text(
      `The spar could not run: ${String(r.body.detail ?? r.body.reason)}.`,
      { ran: false, reason: r.body.reason, detail: r.body.detail ?? null },
      true,
    );
  const b = r.body as {
    winner: string;
    seed: number;
    digest: string;
    version: string;
    rounds: Array<{ n: number; you: string; them: string }>;
  };
  const outcome = b.winner === "you" ? "Your brain won" : b.winner === "them" ? "Your brain lost" : "It was a draw";
  const rounds = b.rounds.map((x) => `round ${x.n}: you ${x.you}, they ${x.them}`).join("; ");
  const { ok: _ok, ...data } = r.body;
  return text(
    `${outcome} against ${args.vs} in ${b.rounds.length} rounds (${b.version}, seed ${b.seed}, digest ${b.digest}). ${rounds}.`,
    { ran: true, ...data },
  );
}

/** A situation in words: the senses of an input word, by the names PET-16x8/1 gives their values. */
const situation = (word: number): string => {
  const s = decodeSenses(word);
  return INPUT_FIELDS.map((f) => `${f.name} ${f.values[s[f.name]]}`).join(", ");
};
const act = (out: number): { want: string; mood: string; nudge: string } => {
  const o = decodeOutput(out);
  return { want: WANTS[o.want]!, mood: MOODS[o.mood]!, nudge: NUDGES[o.nudge]! };
};

/**
 * Every input word on which two minds answer differently, from a fresh memory, and a few examples: one for each
 * distinct change (what it did, what it does), taken from the middle of that change's situations so the example is a
 * typical one rather than the lowest-numbered (which is always the most extreme: starving, filthy, at night).
 */
function differences(
  before: Program,
  after: Program,
): {
  count: number;
  examples: Array<{ situation: string; before: ReturnType<typeof act>; after: ReturnType<typeof act> }>;
} {
  // the compiled netlists themselves, the gates that would be taped out, each beat from a fresh memory
  const brainA = fastBrain(compileProgram(before));
  const brainB = fastBrain(compileProgram(after));
  const stateA = new Uint8Array(brainA.nState);
  const stateB = new Uint8Array(brainB.nState);
  const byChange = new Map<string, number[]>();
  let count = 0;
  for (let w = 0; w < 1 << 16; w++) {
    stateA.fill(0);
    stateB.fill(0);
    const a = brainA.step(stateA, w);
    const b = brainB.step(stateB, w);
    if (a === b) continue;
    count++;
    const key = `${a}:${b}`;
    const list = byChange.get(key);
    if (list) list.push(w);
    else byChange.set(key, [w]);
  }
  const groups = [...byChange.entries()].sort((x, y) => y[1].length - x[1].length);
  const picks: Array<[number, number, number]> = [];
  // first a typical situation of each change, the most common change first; then more of the commonest, spread out
  for (const [key, words] of groups)
    if (picks.length < EXAMPLES)
      picks.push([words[words.length >> 1]!, ...(key.split(":").map(Number) as [number, number])]);
  for (let k = 1; picks.length < EXAMPLES && groups.length && k < EXAMPLES; k++) {
    const [key, words] = groups[0]!;
    const w =
      words[Math.floor((words.length * k) / EXAMPLES) + (words.length >> (EXAMPLES + 1))] ?? words[words.length - 1]!;
    if (!picks.some((p) => p[0] === w)) picks.push([w, ...(key.split(":").map(Number) as [number, number])]);
  }
  return { count, examples: picks.map(([w, a, b]) => ({ situation: situation(w), before: act(a), after: act(b) })) };
}

function cleanRule(v: unknown, what: string): Rule {
  if (!isObj(v)) throw new ToolArgsError(`${what} must be an object with when and then`);
  try {
    return validateProgram({
      version: "LX-PET/1",
      memory: [],
      rules: [v as unknown as Rule],
      otherwise: { want: 0, mood: 1 },
    }).rules[0]!;
  } catch (e) {
    throw new ToolArgsError(`${what} is not a PET-16x8/1 rule: ${(e as Error).message}`);
  }
}

function proposeLessonTool(args: Record<string, unknown>, deps: ToolDeps): ToolResult {
  only(args, ["rule", "line", "lessons"]);
  const line: Line = args.line === undefined ? "gentle" : (args.line as Line);
  if (!LINES.includes(line)) throw new ToolArgsError("line must be gentle, bold or curious");
  if (args.lessons !== undefined && (!Array.isArray(args.lessons) || args.lessons.length > LESSON_CAPACITY.elder))
    throw new ToolArgsError(`lessons must be a list of at most ${LESSON_CAPACITY.elder} rules`);
  const lessons = ((args.lessons as unknown[] | undefined) ?? []).map((l, i) => cleanRule(l, `lessons[${i}]`));
  const rule = cleanRule(args.rule, "rule");
  // the most a pet ever holds is an elder's; younger pets hold fewer, which the answer says
  const check = checkLesson(line, "elder", lessons, rule);
  if (!check.ok) {
    const why = {
      full: `a pet holds at most ${LESSON_CAPACITY.elder} lessons`,
      duplicate: "the pet already has this lesson",
      tooBig: check.detail,
      invalid: check.detail,
    }[check.reason];
    return text(
      `A ${line} pet cannot learn this lesson: ${why}.`,
      { learnable: false, reason: check.reason, detail: check.detail },
      true,
    );
  }
  if (!(deps.proposals ?? sharedProposals).take("everyone"))
    return text(
      "Lingxi is checking many lessons right now; try again in a minute.",
      { learnable: null, reason: "busy" },
      true,
    );
  const before = composeProgram(line, lessons);
  const gatesBefore = gateCount(compileProgram(before));
  const diff = differences(before, check.program);
  const capacity = Object.entries(LESSON_CAPACITY)
    .map(([stage, n]) => `${stage} ${n}`)
    .join(", ");
  const holds = lessons.length + 1;
  const examples = diff.examples
    .map(
      (e) => `when ${e.situation}: it did ${e.before.want} (${e.before.mood}), now ${e.after.want} (${e.after.mood})`,
    )
    .join("; ");
  const changes =
    diff.count === 0
      ? "It changes nothing: in every situation an earlier rule already decides, or the pet already does the same."
      : `It changes what the pet does in ${diff.count} of 65536 situations, from a fresh memory. For example: ${examples}.`;
  return text(
    `A ${line} pet can learn this lesson. Its mind would take ${check.gates} gates (from ${gatesBefore}; the limit is ${MAX_GATES}). ${changes} A pet needs room for ${holds} lesson${holds === 1 ? "" : "s"} (it holds ${capacity} by stage). Nothing was taught.`,
    {
      learnable: true,
      line,
      gates: check.gates,
      gatesBefore,
      maxGates: MAX_GATES,
      lessonsNeeded: holds,
      capacity: LESSON_CAPACITY,
      changedSituations: diff.count,
      examples: diff.examples,
    },
  );
}

export async function callTool(
  name: McpToolName | string,
  args: Record<string, unknown>,
  deps: ToolDeps,
): Promise<ToolResult> {
  switch (name) {
    case "read_pet":
      return readPetTool(args, deps);
    case "run_spar":
      return runSparTool(args);
    case "propose_lesson":
      return proposeLessonTool(args, deps);
    default:
      throw new ToolArgsError(`no tool ${String(name).slice(0, 64)}`);
  }
}
