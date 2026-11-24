/**
 * The tools Lingxi's MCP server offers (plan H7, TAP-15): reading a pet, running a spar, proposing a lesson. Kept free
 * of the game's packages so the manifest script can hash exactly what the server lists: the manifest pins the SHA-256
 * of these definitions, and a change to any covered member makes the signed methods refuse with TOOLS_CHANGED until a
 * new manifest is published. The text is plain ASCII on purpose (TAP-15 §3.4).
 */

const WANT = ["idle", "eat", "play", "sleep", "explore", "sulk", "cuddle", "share"];
const MOOD = ["grumpy", "calm", "happy", "excited"];

const ruleSchema = {
  type: "object",
  description:
    "A rule in the PET-16x8/1 rule language: when every listed sense has one of its listed values, the pet wants `then.want` with mood `then.mood`. Senses (value numbers): hunger 0 full, 1 peckish, 2 hungry, 3 starving; joy 0 sad, 1 low, 2 happy, 3 joyful; energy 0 exhausted, 1 tired, 2 fine, 3 rested; clean 0 filthy, 1 dusty, 2 tidy, 3 spotless; time 0 night, 1 morning, 2 day, 3 evening; action 0 none, 1 feed, 2 play, 3 clean, 4 lightsOff, 5 pet, 6 medicine, 7 talk; event 0 none, 1 friend, 2 toy, 3 scary; owner 0 away, 1 here.",
  properties: {
    label: { type: "string", description: "A few words naming the rule" },
    when: {
      type: "object",
      description: 'Sense name to the list of values it may take, for example {"event": [3], "owner": [1]}',
    },
    then: {
      type: "object",
      properties: {
        want: {
          type: "integer",
          minimum: 0,
          maximum: 7,
          description: `0 to 7: ${WANT.map((w, i) => `${i} ${w}`).join(", ")}`,
        },
        mood: {
          type: "integer",
          minimum: 0,
          maximum: 3,
          description: `0 to 3: ${MOOD.map((m, i) => `${i} ${m}`).join(", ")}`,
        },
        nudge: {
          type: "integer",
          minimum: 0,
          maximum: 7,
          description:
            "0 none, or one step of trait drift: 1 brave, 2 curious, 3 greedy, 4 calm, 5 playful, 6 gentle, 7 shy",
        },
      },
      required: ["want", "mood"],
    },
  },
  required: ["when", "then"],
};

export const MCP_TOOLS = [
  {
    name: "read_pet",
    title: "Read a Lingxi pet",
    description:
      "Read a pet kept on X Layer: its name, owner, line (gentle, bold or curious), brain circuit, day, birth time, log hash and parents, read from the chain, with a link to its public proof page.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", pattern: "^[1-9][0-9]{0,8}$", description: 'The pet\'s number, for example "1"' },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "run_spar",
    title: "Run a spar",
    description:
      "Spar a brain against one of Lingxi's sparring partners or a TapeFly ladder rival and get the whole fight: winner, rounds, moves and the fight's digest. Give the brain as a Lingxi program code (program, lx1....) or a TapeFly brain (chips, comma-separated). The same seed always gives the same fight. The partner and rival ids are listed by the API's partners method.",
    inputSchema: {
      type: "object",
      properties: {
        program: { type: "string", description: "A Lingxi program code, lx1...." },
        chips: { type: "string", description: "A TapeFly brain as comma-separated chips" },
        vs: { type: "string", description: "A partner id such as pip, or fly:<rival id>" },
        seed: { type: "integer", minimum: 0, maximum: 4294967295, description: "Fixes the fight; random when absent" },
      },
      required: ["vs"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "propose_lesson",
    title: "Propose a lesson",
    description:
      "Check a lesson before teaching it: whether a line's pet can learn the rule (on top of the lessons it already has), how many gates the new mind takes against the 500-gate limit, and which situations it changes, with examples of what the pet did before and does after. Nothing is taught and nothing is stored.",
    inputSchema: {
      type: "object",
      properties: {
        rule: ruleSchema,
        line: {
          type: "string",
          enum: ["gentle", "bold", "curious"],
          description: "The pet's line; gentle when absent",
        },
        lessons: {
          type: "array",
          items: ruleSchema,
          maxItems: 8,
          description: "Lessons the pet already has, highest priority first",
        },
      },
      required: ["rule"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];
