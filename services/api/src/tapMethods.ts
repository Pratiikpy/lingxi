/**
 * The agent API's operations as TAP-13 methods (plan H7): each one's descriptor for the TAP-11 manifest and the REST
 * route its params become. Shared by the server (tapApi.ts) and the manifest script, so the two cannot drift.
 */

export type Params = Record<string, unknown>;
/** The REST call a method's params become, or the reason they are malformed. */
export type Route = { verb: "GET" | "POST"; path: string; body?: Params } | string;

export interface TapMethod {
  name: string;
  /** parameter name to type name, informative (TAP-11 §3.3) */
  params: Record<string, string>;
  returns: Record<string, string>;
  description: string;
  route: (p: Params) => Route;
}

const str = (p: Params, k: string): string | undefined | null => (p[k] === undefined ? undefined : typeof p[k] === "string" ? (p[k] as string) : null);
const petId = (p: Params): string | null => {
  const v = p.id;
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : typeof v === "string" ? v : "";
  return /^[1-9]\d{0,8}$/.test(s) ? s : null;
};
const plain = (verb: "GET" | "POST", path: string) => (): Route => ({ verb, path });
const asBody = (path: string) => (p: Params): Route => ({ verb: "POST", path, body: p });

/** Every /api/v1 operation, in the order the agents page lists them. Every price is "0": nothing here is paid. */
export const TAP_METHODS: readonly TapMethod[] = [
  { name: "about", params: {}, returns: { what: "string", docs: "string", endpoints: "object" }, description: "What the API offers and where its documents are", route: plain("GET", "/api/v1") },
  { name: "profiles", params: {}, returns: { profiles: "array" }, description: "The interface manifests: what every input and output bit of a pet brain and a duel brain means", route: plain("GET", "/api/v1/profiles") },
  { name: "partners", params: {}, returns: { partners: "array", flyRivals: "array" }, description: "Sparring partners and TapeFly's ladder rivals, with their programs", route: plain("GET", "/api/v1/partners") },
  {
    name: "spar",
    params: { program: "string?", p1: "string?", chips: "string?", vs: "string", seed: "uint32?" },
    returns: { winner: "string", seed: "uint32", digest: "string", rounds: "array" },
    description: "Spar a brain against a partner or fly:<rival>; a fixed seed gives a fixed fight",
    route: (p) => {
      const q = new URLSearchParams();
      for (const k of ["program", "p1", "chips", "vs"]) {
        const v = str(p, k);
        if (v === null) return `${k} must be a string`;
        if (v !== undefined) q.set(k, v);
      }
      if (p.seed !== undefined) {
        const s = typeof p.seed === "number" && Number.isSafeInteger(p.seed) && p.seed >= 0 && p.seed < 2 ** 32 ? String(p.seed) : typeof p.seed === "string" && /^\d{1,10}$/.test(p.seed) ? p.seed : null;
        if (s === null) return "seed must be a whole number from 0 to 4294967295";
        q.set("seed", s);
      }
      return { verb: "GET", path: `/api/v1/spar?${q.toString()}` };
    },
  },
  {
    name: "pet",
    params: { id: "string" },
    returns: { owner: "address", line: "string", brainId: "string", day: "number", logHash: "bytes32", image: "string" },
    description: "A pet on X Layer: owner, line, brain circuit, day, log hash and its picture as drawn on chain",
    route: (p) => (petId(p) ? { verb: "GET", path: `/api/v1/pets/${petId(p)}` } : "id must be a pet number from 1 to 999999999"),
  },
  {
    name: "brain",
    params: { id: "string" },
    returns: { processor: "address", brainId: "string", netlist: "bytes", nIn: "number", nOut: "number", nState: "number" },
    description: "A pet's brain netlist as stored on chain (TAP-02 bytes)",
    route: (p) => (petId(p) ? { verb: "GET", path: `/api/v1/pets/${petId(p)}/brain` } : "id must be a pet number from 1 to 999999999"),
  },
  { name: "scoreboard", params: {}, returns: { weeks: "array" }, description: "Agent-raised against human-raised pets, week by week", route: plain("GET", "/api/v1/scoreboard") },
  { name: "adopt", params: { agent: "string", name: "string", line: "string", instincts: "number?" }, returns: { token: "string", pet: "object" }, description: "Adopt a pet; the token is shown once, send it as Authorization: Bearer", route: asBody("/api/v1/agents/adopt") },
  { name: "me", params: {}, returns: { pet: "object" }, description: "Your pet now (Authorization: Bearer <token>)", route: plain("GET", "/api/v1/agents/me") },
  { name: "care", params: { action: "string", food: "string?" }, returns: { pet: "object" }, description: "Feed, play, clean, pet, give medicine, put to sleep, wake or talk", route: asBody("/api/v1/agents/me/care") },
  { name: "teach", params: { rule: "object" }, returns: { ok: "boolean" }, description: "Teach a rule in the PET-16x8/1 rule language", route: asBody("/api/v1/agents/me/teach") },
  { name: "season", params: {}, returns: { ok: "boolean" }, description: "Enter your pet in this week's season, marked as raised by an agent", route: plain("POST", "/api/v1/agents/me/season") },
];

/** The method descriptors of the manifest (TAP-11 §3.3): every price "0". */
export const manifestMethods = () => TAP_METHODS.map((m) => ({ name: m.name, priceBEM: "0", params: m.params, returns: m.returns, description: m.description }));
