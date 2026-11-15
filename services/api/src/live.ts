/**
 * Live rooms: other players' pets in the same place, in real time.
 *
 * Every world room is a shared space; each player's home is its own space that
 * friends can visit by link ("home:<owner>"). A space holds at most CAPACITY
 * pets; beyond that, players are spread over parallel copies so rooms never
 * feel crowded. Messages are small JSON frames; everything a client sends is
 * checked, trimmed and rate limited before anyone else sees it.
 */

import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { DecorStore } from "./decor";

export const CAPACITY = 24;
const MAX_FRAME = 12_288;
const CARD_MAX = 10_000;
const CARD_RULES = 8;
const PROPOSAL_MS = 120_000;
const SAY_MAX = 60;
const NAME_MAX = 12;
const LINES = new Set(["gentle", "bold", "curious"]);
const STAGES = new Set(["baby", "child", "teen", "adult", "elder"]);
const EMOTES = new Set(["wave", "heart", "laugh", "sleepy", "dance", "gift"]);
const BLOCKED = /(fuck|shit|cunt|nigg|fag|rape|\bkill\b|操你|傻逼|妈的|去死)/i;

export interface Member {
  id: string;
  name: string;
  line: string;
  stage: string;
  mood: number;
  x: number;
}

interface Client {
  ws: WebSocket;
  member: Member;
  /** the pet's taught lessons as JSON, shared so friends can spar against its real brain */
  card: string | null;
  /** who has asked this client's owner to raise a little one together, and when */
  proposals: Map<string, number>;
  space: string | null;
  tokens: number;
  last: number;
}

const clean = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max) : "";

/** A pet's on-chain identity, passed along so a family can be made on chain; checked for shape only. */
function chainInfo(v: unknown): { petId: string; owner: string; brain: string } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const c = v as Record<string, unknown>;
  if (typeof c.petId !== "string" || !/^\d{1,20}$/.test(c.petId)) return undefined;
  if (typeof c.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(c.owner)) return undefined;
  if (typeof c.brain !== "string" || !/^\d{1,20}$/.test(c.brain)) return undefined;
  return { petId: c.petId, owner: c.owner, brain: c.brain };
}

/** A world room ("room:65") or a home ("home:<owner id>"); anything else is refused. */
export function validSpace(s: unknown): string | null {
  if (typeof s !== "string") return null;
  if (/^room:\d{1,4}$/.test(s)) return s;
  if (/^home:[a-z0-9]{6,32}$/.test(s)) return s;
  return null;
}

export class LiveRooms {
  private readonly clients = new Set<Client>();
  private readonly spaces = new Map<string, Set<Client>>();

  constructor(private readonly decor?: DecorStore) {}

  stats(): { online: number; spaces: number } {
    return { online: [...this.clients].filter((c) => c.space).length, spaces: this.spaces.size };
  }

  /** Picks the first copy of a space with room to spare. */
  private placeIn(space: string): string {
    for (let i = 0; ; i++) {
      const key = i === 0 ? space : `${space}#${i}`;
      const set = this.spaces.get(key);
      if (!set || set.size < CAPACITY) return key;
    }
  }

  private send(c: Client, msg: unknown): void {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  private broadcast(space: string, msg: unknown, except?: Client): void {
    for (const c of this.spaces.get(space) ?? []) if (c !== except) this.send(c, msg);
  }

  private leave(c: Client): void {
    if (!c.space) return;
    const set = this.spaces.get(c.space);
    set?.delete(c);
    this.broadcast(c.space, { t: "left", id: c.member.id });
    if (set && set.size === 0) this.spaces.delete(c.space);
    c.space = null;
  }

  private join(c: Client, space: string): void {
    this.leave(c);
    const key = this.placeIn(space);
    let set = this.spaces.get(key);
    if (!set) {
      set = new Set();
      this.spaces.set(key, set);
    }
    set.add(c);
    c.space = key;
    this.send(c, { t: "room", space: key, members: [...set].filter((o) => o !== c).map((o) => o.member) });
    this.broadcast(key, { t: "joined", member: c.member }, c);
    // a home shows its owner's decorations to everyone who comes in
    if (space.startsWith("home:")) {
      const owner = space.slice(5);
      this.send(c, { t: "decor", owner, placed: this.decor?.get(owner) ?? [] });
    }
  }

  /** Token bucket: 8 messages, refilled at 2 per second. */
  private allow(c: Client): boolean {
    const now = Date.now();
    c.tokens = Math.min(8, c.tokens + ((now - c.last) / 1000) * 2);
    c.last = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  /** Another client in the same space, by member id. */
  private peer(c: Client, id: unknown): Client | null {
    if (!c.space || !c.member.id || typeof id !== "string") return null;
    return [...(this.spaces.get(c.space) ?? [])].find((o) => o.member.id === id && o !== c) ?? null;
  }

  handle(ws: WebSocket): void {
    const c: Client = { ws, card: null, proposals: new Map(), member: { id: "", name: "", line: "gentle", stage: "baby", mood: 1, x: 64 }, space: null, tokens: 8, last: Date.now() };
    this.clients.add(c);
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const text = raw.toString();
      if (text.length > MAX_FRAME || !this.allow(c)) return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      this.onMessage(c, m);
    });
    ws.on("close", () => {
      this.leave(c);
      this.clients.delete(c);
    });
    ws.on("error", () => ws.close());
  }

  private onMessage(c: Client, m: Record<string, unknown>): void {
    switch (m.t) {
      case "hello": {
        const id = clean(m.id, 32).toLowerCase();
        if (!/^[a-z0-9]{6,32}$/.test(id)) return;
        const name = clean(m.name, NAME_MAX) || "Pet";
        c.member = {
          id,
          name: BLOCKED.test(name) ? "Pet" : name,
          line: LINES.has(m.line as string) ? (m.line as string) : "gentle",
          stage: STAGES.has(m.stage as string) ? (m.stage as string) : "baby",
          mood: Number.isInteger(m.mood) ? Math.max(0, Math.min(3, m.mood as number)) : 1,
          x: 64,
        };
        const space = validSpace(m.space);
        if (space) this.join(c, space);
        return;
      }
      case "go": {
        const space = validSpace(m.space);
        if (space && c.member.id) this.join(c, space);
        return;
      }
      case "pos": {
        if (!c.space || typeof m.x !== "number" || !Number.isFinite(m.x)) return;
        c.member = { ...c.member, x: Math.max(8, Math.min(120, Math.round(m.x))) };
        this.broadcast(c.space, { t: "pos", id: c.member.id, x: c.member.x }, c);
        return;
      }
      case "mood": {
        if (!c.space || !Number.isInteger(m.mood)) return;
        c.member = { ...c.member, mood: Math.max(0, Math.min(3, m.mood as number)) };
        this.broadcast(c.space, { t: "mood", id: c.member.id, mood: c.member.mood }, c);
        return;
      }
      case "emote": {
        if (!c.space || !EMOTES.has(m.kind as string)) return;
        const to = typeof m.to === "string" ? clean(m.to, 32) : undefined;
        this.broadcast(c.space, { t: "emote", id: c.member.id, kind: m.kind, ...(to ? { to } : {}) });
        return;
      }
      case "decor": {
        // only for your own home, and only with the key your device bound it to
        if (!this.decor || !c.member.id) return;
        const placed = this.decor.set(c.member.id, m.key, m.placed);
        if (!placed) return this.send(c, { t: "decorRefused" });
        const home = `home:${c.member.id}`;
        for (const key of this.spaces.keys()) if (key === home || key.startsWith(`${home}#`)) this.broadcast(key, { t: "decor", owner: c.member.id, placed });
        return;
      }
      case "card": {
        if (typeof m.lessons !== "string" || m.lessons.length > CARD_MAX) return;
        try {
          // a pet card: its lessons, and for a child its family (parents' lessons); shape-checked here, fully validated by whoever uses it
          const card = JSON.parse(m.lessons) as { lessons?: unknown; family?: unknown } | unknown[];
          const rules = Array.isArray(card) ? card : card.lessons;
          if (!Array.isArray(rules) || rules.length > CARD_RULES) return;
        } catch {
          return;
        }
        c.card = m.lessons;
        return;
      }
      case "propose": {
        const target = this.peer(c, m.to);
        if (!target) return;
        target.proposals.set(c.member.id, Date.now());
        const chain = chainInfo(m.chain);
        this.send(target, { t: "proposal", from: c.member.id, name: c.member.name, stage: c.member.stage, line: c.member.line, ...(chain ? { chain } : {}) });
        return;
      }
      case "answer": {
        const proposer = this.peer(c, m.to);
        if (!proposer) return;
        const at = c.proposals.get(proposer.member.id);
        // only an answer to a real, recent proposal goes through
        if (at === undefined || Date.now() - at > PROPOSAL_MS) return;
        c.proposals.delete(proposer.member.id);
        const yes = m.yes === true;
        const chain = yes ? chainInfo(m.chain) : undefined;
        this.send(proposer, { t: "answer", from: c.member.id, name: c.member.name, yes, ...(yes ? { line: c.member.line, stage: c.member.stage, card: c.card ?? "[]" } : {}), ...(chain ? { chain } : {}) });
        return;
      }
      case "ask": {
        if (!c.space || typeof m.to !== "string") return;
        const target = [...(this.spaces.get(c.space) ?? [])].find((o) => o.member.id === m.to && o !== c);
        if (!target) return;
        this.send(c, { t: "card", id: target.member.id, name: target.member.name, line: target.member.line, stage: target.member.stage, lessons: target.card ?? "[]" });
        this.send(target, { t: "asked", from: c.member.id, name: c.member.name });
        return;
      }
      case "say": {
        if (!c.space) return;
        const text = clean(m.text, SAY_MAX);
        if (!text || BLOCKED.test(text)) return;
        this.broadcast(c.space, { t: "say", id: c.member.id, text });
        return;
      }
      default:
    }
  }
}

/** Attaches live rooms to an HTTP server at /live, accepting only allowed origins. */
export function attachLive(server: { on(event: "upgrade", cb: (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => void): unknown }, rooms: LiveRooms, origins: string[]): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const origin = req.headers.origin ?? "";
    if (!url.startsWith("/live") || (origin && !origins.includes(origin))) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => rooms.handle(ws));
  });
  return wss;
}
