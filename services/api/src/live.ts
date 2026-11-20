/**
 * Live rooms: other players' pets in the same place, in real time.
 *
 * Every world room is a shared space; each player's home is its own space that
 * friends can visit by link ("home:<owner>"). A space holds at most CAPACITY
 * pets; beyond that, players are spread over parallel copies so rooms never
 * feel crowded. Messages are small JSON frames; everything a client sends is
 * checked, trimmed and rate limited before anyone else sees it.
 *
 * A player is in a room only as itself: its hello carries the secret key its id
 * comes from (see decor.ts), so an id seen in a room cannot be used by anyone
 * else. One address holds at most MAX_PER_ADDRESS connections.
 */

import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { type DecorStore, type Placed, createDecorStore } from "./decor";
import { type Homes, visible } from "./homes";
import { CARD_MAX, canonicalCard, shownName } from "@lingxi/game";
import { MAX_PLACED } from "@lingxi/world";
import { RateLimiter } from "./limit";
import { callerOf } from "./clientIp";
import { BLOCKED_WORDS as BLOCKED } from "./words";

export const CAPACITY = 24;
/** Connections one address may hold: enough for a family's or a classroom's devices behind one router, not a flood. */
export const MAX_PER_ADDRESS = 12;
/** Connections the server holds in all. */
export const MAX_CONNECTIONS = 4_000;
/** New homes (the first decorations or the first wallet for an id) one address may make in a day. */
export const MAX_NEW_HOMES_PER_DAY = 5;
const MAX_FRAME = 12_288;
/** A pet's card is the one message allowed to be longer: the game's whole card budget, with room for its envelope (A26). */
const MAX_CARD_FRAME = 2 * CARD_MAX + 1_024;
/** A card may hold as many lessons as a pet can learn (it was 8, which dropped a well-taught pet's card, A26). */
const PROPOSAL_MS = 120_000;
/** What the room keeps of a card that does not read as a pet card: the game reads it as damaged (A77). */
export const DAMAGED_CARD = '{"damaged":true}';
/** The most proposals one pet holds waiting for an answer (A64). */
const MAX_PROPOSALS = 16;
const SAY_MAX = 60;
const NAME_MAX = 12;
const LINES = new Set(["gentle", "bold", "curious"]);
const STAGES = new Set(["baby", "child", "teen", "adult", "elder"]);
const EMOTES = new Set(["wave", "heart", "laugh", "sleepy", "dance", "gift"]);

export interface Member {
  id: string;
  name: string;
  line: string;
  stage: string;
  mood: number;
  x: number;
  /** the pet's name colour (plan 4.9), present only when a wallet linked to this player's home owns the pet */
  colour?: number;
}

interface Client {
  ws: WebSocket;
  member: Member;
  /** the pet's taught lessons as JSON, shared so friends can spar against its real brain */
  card: string | null;
  /** who has asked this client's owner to raise a little one together, and when */
  proposals: Map<string, number>;
  space: string | null;
  /** the pet's id on X Layer, as the client said in its hello; its name colour is read from it */
  petId: string | null;
  /** the visitor's address, for the limits kept per address */
  address: string;
  tokens: number;
  last: number;
  /** bumped each time the card changes: an asker is sent a card once per change (A61) */
  cardVersion: number;
  /** the card version of each pet this client has been sent */
  seen: Map<string, number>;
  /** when this client last asked for cards, for the per-connection limit */
  asks: number[];
  /** answered the last ping; when it last sent anything */
  alive: boolean;
  heard: number;
}

/** How a room watches its connections and limits asks (A61). */
export interface RoomLimits {
  /** a connection that sends nothing for this long is closed with 4001 ("idle") */
  idleMs: number;
  /** every connection is pinged this often, and dropped if it has not answered the last ping */
  pingMs: number;
  /** asks for a card one connection may make in a minute, and one address */
  asksPerConnection: number;
  asksPerAddress: number;
}
const ROOM_LIMITS: RoomLimits = { idleMs: 15 * 60_000, pingMs: 30_000, asksPerConnection: 6, asksPerAddress: 30 };
/** The close code for a connection let go for being idle: the game reconnects on the player's next action. */
export const IDLE_CLOSE = 4001;

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

  private readonly limits: RoomLimits;
  private readonly askers: RateLimiter;
  private watching: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly decor: DecorStore = createDecorStore(),
    private readonly homes?: Homes,
    limits: Partial<RoomLimits> = {},
  ) {
    this.limits = { ...ROOM_LIMITS, ...limits };
    this.askers = new RateLimiter(this.limits.asksPerAddress, 60_000);
  }

  /** Pings every connection, drops one that did not answer the last ping, and closes one silent past the idle time. */
  private watch(): void {
    if (this.watching) return;
    this.watching = setInterval(() => {
      const now = Date.now();
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        if (now - c.heard > this.limits.idleMs) {
          c.ws.close(IDLE_CLOSE, "idle");
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          c.ws.terminate();
        }
      }
    }, this.limits.pingMs);
    this.watching.unref?.();
  }

  /** A home's pieces as a visitor sees them: what the owner placed, cut to what its linked wallets allow on X Layer. */
  private async shown(owner: string, who?: string): Promise<Placed> {
    const placed = this.decor.get(owner) ?? [];
    return visible(placed, this.homes ? await this.homes.view(owner, who) : { capacity: MAX_PLACED, held: [] });
  }

  /** Sends a home's pieces to everyone in it (every copy of the space). */
  private async showHome(owner: string): Promise<void> {
    const placed = await this.shown(owner);
    const home = `home:${owner}`;
    for (const key of this.spaces.keys()) if (key === home || key.startsWith(`${home}#`)) this.broadcast(key, { t: "decor", owner, placed });
  }

  /**
   * Reads a member's name colour and tells everyone in its space when it changed (colour 0 is plain). A colour is
   * only ever given while a wallet linked to the player's home owns the pet; see Homes.colourOf.
   */
  private async recolour(c: Client, fresh: boolean): Promise<void> {
    if (!this.homes) return;
    const id = c.member.id;
    const petId = c.petId;
    const colour = petId ? await this.homes.colourOf(id, petId, fresh) : 0;
    // the client may have said hello as another pet in the meantime; then that hello's reading counts
    if (c.member.id !== id || c.petId !== petId || (c.member.colour ?? 0) === colour) return;
    const next: Member = { ...c.member };
    if (colour) next.colour = colour;
    else delete next.colour;
    c.member = next;
    if (c.space) this.broadcast(c.space, { t: "colour", id, colour });
  }

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
    // a home shows its owner's decorations to everyone who comes in, as its linked wallets allow
    if (space.startsWith("home:")) {
      const owner = space.slice(5);
      // the visitor's own views of homes are limited (A81)
      void this.shown(owner, c.address).then((placed) => {
        if (c.space?.startsWith(space)) this.send(c, { t: "decor", owner, placed });
      });
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

  /** new homes per address per day: a home kept on the server costs a little of its room, so no one fills it */
  private readonly newHomes = new RateLimiter(MAX_NEW_HOMES_PER_DAY, 86_400_000);

  /** True when this would make a home the server does not keep yet, and the address has used its day's share. */
  private overHomeShare(c: Client): boolean {
    const id = c.member.id;
    const fresh = !this.decor.holds(id) && !(this.homes?.wallets(id).length ?? 0);
    return fresh && !this.newHomes.take(c.address);
  }

  handle(ws: WebSocket, address = "local"): void {
    const c: Client = { ws, card: null, proposals: new Map(), member: { id: "", name: "", line: "gentle", stage: "baby", mood: 1, x: 64 }, space: null, petId: null, address, tokens: 8, last: Date.now(), cardVersion: 0, seen: new Map(), asks: [], alive: true, heard: Date.now() };
    this.clients.add(c);
    this.watch();
    ws.on("pong", () => (c.alive = true));
    ws.on("message", (raw, isBinary) => {
      c.heard = Date.now();
      if (isBinary) return;
      const text = raw.toString();
      if (text.length > MAX_CARD_FRAME || !this.allow(c)) return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      // every message but a card stays small; a card may be as long as the game's card budget (A26)
      if (text.length > MAX_FRAME && m.t !== "card") return;
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
        // only the device holding the key behind this id may be it
        if (!/^[a-z0-9]{6,32}$/.test(id) || !this.decor.authorise(id, m.key)) return this.send(c, { t: "refused", reason: "id" });
        // a hidden character is shown, so no pet in the room can pass for another (A16)
        const name = shownName(m.name, NAME_MAX) || "Pet";
        c.member = {
          id,
          name: BLOCKED.test(name) ? "Pet" : name,
          line: LINES.has(m.line as string) ? (m.line as string) : "gentle",
          stage: STAGES.has(m.stage as string) ? (m.stage as string) : "baby",
          mood: Number.isInteger(m.mood) ? Math.max(0, Math.min(3, m.mood as number)) : 1,
          x: 64,
        };
        // the player is here: its home's links are the last to go when the server's store of them is full (A74)
        this.homes?.seen(id);
        const space = validSpace(m.space);
        if (space) this.join(c, space);
        // the pet's name colour, only when a wallet linked to this player's home owns the pet on X Layer
        c.petId = typeof m.petId === "string" && /^\d{1,20}$/.test(m.petId) ? m.petId : null;
        void this.recolour(c, false);
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
        if (!c.member.id) return;
        const something = Array.isArray(m.placed) && m.placed.length > 0;
        if (something && this.overHomeShare(c)) return this.send(c, { t: "decorRefused", reason: "tooMany" });
        const placed = this.decor.set(c.member.id, m.key, m.placed);
        if (!placed) return this.send(c, { t: "decorRefused" });
        void this.showHome(c.member.id);
        return;
      }
      case "link":
      case "unlink": {
        // a wallet joins or leaves this player's home: only with the home's own key, and to join, the wallet's signature
        if (!this.homes || !c.member.id) return;
        const owner = c.member.id;
        if (!this.decor.authorise(owner, m.key)) return this.send(c, { t: "linked", ok: false, reason: "key" });
        if (m.t === "link" && this.overHomeShare(c)) return this.send(c, { t: "linked", ok: false, reason: "tooMany" });
        const done = (r: { ok: true; wallets: string[] } | { ok: false; reason: string }) => {
          this.send(c, r.ok ? { t: "linked", ok: true, wallets: r.wallets } : { t: "linked", ok: false, reason: r.reason });
          if (!r.ok) return;
          void this.showHome(owner);
          // the player's pets already out in rooms gain or lose their colour with the wallets that vouch for it
          for (const other of this.clients) if (other.member.id === owner) void this.recolour(other, false);
        };
        if (m.t === "unlink") done(this.homes.unlink(owner, m.wallet));
        else void this.homes.link(owner, m.wallet, m.signature).then(done);
        return;
      }
      case "recolour": {
        // the player changed the name colour on chain: look again (the homes service limits how often)
        if (c.member.id) void this.recolour(c, true);
        return;
      }
      case "links": {
        if (!this.homes || !c.member.id || !this.decor.authorise(c.member.id, m.key)) return;
        this.send(c, { t: "linked", ok: true, wallets: this.homes.wallets(c.member.id) });
        return;
      }
      case "card": {
        if (typeof m.lessons !== "string" || m.lessons.length > CARD_MAX) return;
        // a pet card: its lessons, and for a child its family (parents' lessons), kept only in its own shape, so nothing
        // a sender adds travels with it (A77); whoever uses it still validates it in full
        // a card that does not read as one is kept as a short mark the game reads as damaged, so a friend is told the
        // card is damaged, as before, and none of it travels
        const card = canonicalCard(m.lessons) ?? DAMAGED_CARD;
        if (card === c.card) return;
        c.card = card;
        c.cardVersion++;
        return;
      }
      case "propose": {
        const target = this.peer(c, m.to);
        if (!target) return;
        // a target keeps only recent proposals, and at most MAX_PROPOSALS, the oldest dropped (A64)
        const now = Date.now();
        for (const [who, at] of target.proposals) if (now - at > PROPOSAL_MS) target.proposals.delete(who);
        target.proposals.delete(c.member.id);
        target.proposals.set(c.member.id, now);
        while (target.proposals.size > MAX_PROPOSALS) target.proposals.delete(target.proposals.keys().next().value!);
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
        // the card once per change, as an ask sends it; after that the proposer's game uses the one it kept (A77)
        let card: { card: string } | { cardUnchanged: true } | Record<string, never> = {};
        if (yes) {
          if (proposer.seen.get(c.member.id) === c.cardVersion) card = { cardUnchanged: true };
          else {
            proposer.seen.set(c.member.id, c.cardVersion);
            card = { card: c.card ?? "[]" };
          }
        }
        this.send(proposer, { t: "answer", from: c.member.id, name: c.member.name, yes, ...(yes ? { line: c.member.line, stage: c.member.stage, ...card } : {}), ...(chain ? { chain } : {}) });
        return;
      }
      case "ask": {
        if (!c.space || typeof m.to !== "string") return;
        const target = [...(this.spaces.get(c.space) ?? [])].find((o) => o.member.id === m.to && o !== c);
        if (!target) return;
        // a few asks a minute, per connection and per address (A61)
        const now = Date.now();
        c.asks = c.asks.filter((t) => now - t < 60_000);
        if (c.asks.length >= this.limits.asksPerConnection || !this.askers.take(c.address)) return;
        c.asks.push(now);
        // the whole card once per change of it; after that a short answer, and the game keeps the card it has (A61)
        const about = { t: "card", id: target.member.id, name: target.member.name, line: target.member.line, stage: target.member.stage };
        if (c.seen.get(target.member.id) === target.cardVersion) this.send(c, { ...about, unchanged: true });
        else {
          c.seen.set(target.member.id, target.cardVersion);
          this.send(c, { ...about, lessons: target.card ?? "[]" });
        }
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

/**
 * The visitor's address: Cloudflare's header (the server listens only behind the tunnel), else the socket's, keyed as
 * every HTTP limit keys it (`callerOf`): an IPv6 caller is its /64, a mapped IPv4 its IPv4 (A74).
 */
export function addressOf(req: IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && isIP(cf.trim())) return callerOf(cf.trim());
  const remote = req.socket.remoteAddress;
  return remote && isIP(remote) ? callerOf(remote) : "local";
}

/** Attaches live rooms to an HTTP server at /live, accepting only allowed origins and a few connections per address. */
export function attachLive(server: { on(event: "upgrade", cb: (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => void): unknown }, rooms: LiveRooms, origins: string[]): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CARD_FRAME });
  const held = new Map<string, number>();
  let total = 0;
  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const origin = req.headers.origin ?? "";
    if (!url.startsWith("/live") || (origin && !origins.includes(origin))) {
      socket.destroy();
      return;
    }
    const address = addressOf(req);
    if ((held.get(address) ?? 0) >= MAX_PER_ADDRESS || total >= MAX_CONNECTIONS) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    held.set(address, (held.get(address) ?? 0) + 1);
    total++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      total--;
      const n = (held.get(address) ?? 1) - 1;
      if (n > 0) held.set(address, n);
      else held.delete(address);
    };
    socket.once("close", release);
    wss.handleUpgrade(req, socket, head, (ws) => rooms.handle(ws, address));
  });
  return wss;
}
