/**
 * Live presence in the browser: one WebSocket to our server, the space we are
 * in (the world room, our home, or a friend's home we are visiting), and the
 * other pets there. Reconnects with backoff; quietly does nothing when the
 * server is not configured (the DeWEB build).
 */

import { create } from "zustand";
import { PLAYER_SECRET, playerIdFor } from "@lingxi/chain/player";
import { shownName } from "@lingxi/game";
import { noteEvent } from "./tally";
import { saveWrite } from "./saveRuntime";

const LIVE_URL = (import.meta.env.VITE_LIVE_URL as string | undefined) ?? (location.hostname === "localhost" ? "ws://localhost:8787/live" : "");
/** The server's longest pet name; every name that arrives is shown as shownName shows it (A16), whatever a server sent. */
const NAME_MAX = 12;
const nameIn = (m: Record<string, unknown>): string => shownName(m.name, NAME_MAX) || "Pet";
const named = (x: LiveMember): LiveMember => ({ ...x, name: shownName(x.name, NAME_MAX) || "Pet" });
const PLAYER_KEY = "lingxi.player.v1";

/**
 * This player's public id (rooms, home, invite links). A new device's id comes from its secret key (decorKey), so
 * the server knows the id is ours without trusting whoever says it first; an id from before then is kept while the
 * server still knows it as ours (see `moveToKeyedId`).
 */
export function playerId(): string {
  try {
    const saved = localStorage.getItem(PLAYER_KEY);
    if (saved && /^[a-z0-9]{12,32}$/.test(saved)) return saved;
    const id = playerIdFor(decorKey());
    saveWrite(PLAYER_KEY, id);
    return id;
  } catch {
    return playerIdFor(decorKey());
  }
}

/**
 * The server refused our id: it was never bound to this device's key (an id from before ids came from keys, never
 * used for a home), or someone else holds it. Take the id that comes from our own key instead; it cannot be refused.
 * Returns false when we already have that id, so a refusal never loops.
 */
function moveToKeyedId(): boolean {
  const keyed = playerIdFor(decorKey());
  if (playerId() === keyed) return false;
  try {
    saveWrite(PLAYER_KEY, keyed);
  } catch {
    // without storage, playerId() already answers the keyed id
  }
  return true;
}

/** A friend's home we arrived at through an invite link (?visit=<id>). */
export function visitingFrom(search = location.search): string | null {
  const v = new URLSearchParams(search).get("visit");
  return v && /^[a-z0-9]{12,32}$/.test(v) && v !== playerId() ? v : null;
}

/** A pet's on-chain identity shared when making a family: pet id, owner, and its current brain circuit. */
export interface ChainInfo {
  petId: string;
  owner: string;
  brain: string;
}

const asChain = (v: unknown): ChainInfo | undefined => {
  const c = v as Partial<ChainInfo> | undefined;
  return c && typeof c.petId === "string" && typeof c.owner === "string" && typeof c.brain === "string" ? { petId: c.petId, owner: c.owner, brain: c.brain } : undefined;
};

export interface LiveMember {
  id: string;
  name: string;
  line: string;
  stage: string;
  mood: number;
  x: number;
  /** the pet's name colour (plan 4.9), sent only when the server checked a linked wallet owns the pet */
  colour?: number;
  emote?: { kind: string; at: number };
  say?: { text: string; at: number };
}

interface Me {
  name: string;
  line: string;
  stage: string;
  mood: number;
  /** the pet's id on X Layer, so the server can show its name colour */
  petId?: string;
}

interface LiveState {
  status: "off" | "connecting" | "on";
  space: string | null;
  members: Record<string, LiveMember>;
  /** wallets linked to this player's home (plan 4.9); null until the server answers */
  links: string[] | null;
  /** the last link or unlink answer, for the panel to report */
  linkAnswer: { ok: boolean; reason?: string; at: number } | null;
  /** the server did not keep our home's decorations (visitors see the room as it was), and why */
  decorRefused: { reason: string; at: number } | null;
  /** link a wallet that signed `homeLinkMessage(playerId())`, or unlink one */
  link: (wallet: string, signature: string) => void;
  unlink: (wallet: string) => void;
  /** after the player changed the pet's name colour on chain: ask the server to look again */
  recolour: () => void;
  /** last emote others sent to us, for the scene */
  incoming: { from: string; kind: string; at: number } | null;
  /** a friend's pet card we asked for, to spar against */
  card: { id: string; name: string; line: string; stage: string; lessons: string; at: number } | null;
  /** someone just sparred against our pet */
  asked: { name: string; at: number } | null;
  /** share this pet's card (its lessons, and family for a child) with the room */
  shareCard: (card: string) => void;
  /** the decorations of the home we are in, as its owner left them */
  homeDecor: { owner: string; placed: Array<{ id: string; x: number; y: number }> } | null;
  /** keep our home's decorations on the server so visitors see them */
  shareDecor: (placed: Array<{ id: string; x: number; y: number }>) => void;
  /** a family proposal another owner sent us */
  proposal: { from: string; name: string; stage: string; line: string; chain?: ChainInfo; at: number } | null;
  /** the answer to our proposal */
  answer: { from: string; name: string; yes: boolean; line?: string; stage?: string; card?: string; chain?: ChainInfo; at: number } | null;
  propose: (to: string, chain?: ChainInfo) => void;
  reply: (to: string, yes: boolean, chain?: ChainInfo) => void;
  clearFamily: () => void;
  ask: (id: string) => void;
  connect: (me: Me, space: string) => void;
  go: (space: string) => void;
  pos: (x: number) => void;
  mood: (m: number) => void;
  emote: (kind: string, to?: string) => void;
  say: (text: string) => void;
}

let ws: WebSocket | null = null;
let retry = 0;
let me: Me | null = null;
let want: string | null = null;
let lessonsCard: string | null = null;
let decorShared: string | null = null;

/** A key made for this page only, when the browser keeps no storage: never one shared by every such player. */
let sessionKey: string | null = null;
const freshKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** This device's secret key: its player id comes from it, and it proves to the server that the id and home are ours. */
function decorKey(): string {
  const k = "lingxi.decorKey";
  try {
    const held = localStorage.getItem(k);
    if (held && PLAYER_SECRET.test(held)) return held;
    const fresh = freshKey();
    saveWrite(k, fresh);
    return fresh;
  } catch {
    sessionKey ??= freshKey();
    return sessionKey;
  }
}

const send = (m: unknown) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
};

export const useLive = create<LiveState>((set, get) => {
  const open = () => {
    if (!LIVE_URL || !me || !want) return;
    set({ status: "connecting" });
    const sock = new WebSocket(LIVE_URL);
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      set({ status: "on" });
      send({ t: "hello", id: playerId(), key: decorKey(), ...me, space: want });
      send({ t: "links", key: decorKey() });
      if (lessonsCard) send({ t: "card", lessons: lessonsCard });
      if (decorShared) send({ t: "decor", key: decorKey(), placed: JSON.parse(decorShared) });
    };
    sock.onmessage = (ev) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const members = { ...get().members };
      switch (m.t) {
        case "refused": {
          // our id is not ours on the server: move to the id our own key gives, and come in again as that
          const before = playerId();
          if (m.reason !== "id" || !me || !moveToKeyedId()) return;
          if (want === `home:${before}`) want = `home:${playerId()}`;
          send({ t: "hello", id: playerId(), key: decorKey(), ...me, space: want });
          send({ t: "links", key: decorKey() });
          set({ space: null });
          return;
        }
        case "room":
          set({ space: m.space as string, members: Object.fromEntries((m.members as LiveMember[]).map((x) => [x.id, named(x)])) });
          return;
        case "joined": {
          const x = named(m.member as LiveMember);
          members[x.id] = x;
          // a friend's pet arrived in our own home (quests count it)
          if (get().space === `home:${playerId()}` && x.id !== playerId()) noteEvent("visited-by-friend");
          return set({ members });
        }
        case "left":
          delete members[m.id as string];
          return set({ members });
        case "pos":
        case "mood": {
          const x = members[m.id as string];
          if (!x) return;
          members[x.id] = { ...x, ...(m.t === "pos" ? { x: m.x as number } : { mood: m.mood as number }) };
          return set({ members });
        }
        case "emote": {
          const from = m.id as string;
          if (from === playerId()) return;
          const x = members[from];
          if (x) members[from] = { ...x, emote: { kind: m.kind as string, at: performance.now() } };
          set({ members, ...(m.to === playerId() || !m.to ? { incoming: { from, kind: m.kind as string, at: performance.now() } } : {}) });
          return;
        }
        case "decor":
          if (typeof m.owner === "string" && Array.isArray(m.placed)) set({ homeDecor: { owner: m.owner, placed: m.placed as Array<{ id: string; x: number; y: number }> } });
          return;
        case "colour": {
          const x = members[m.id as string];
          if (!x || !Number.isInteger(m.colour)) return;
          // 0 is plain: the server stopped vouching for the colour (a wallet was unlinked, or it changed on chain)
          const { colour: _was, ...rest } = x;
          members[x.id] = (m.colour as number) > 0 ? { ...rest, colour: m.colour as number } : rest;
          return set({ members });
        }
        case "decorRefused":
          // forget what was sent, so the next change or the next visit tries again
          decorShared = null;
          set({ decorRefused: { reason: typeof m.reason === "string" ? m.reason : "refused", at: performance.now() } });
          return;
        case "linked":
          if (m.ok === true && Array.isArray(m.wallets)) set({ links: (m.wallets as unknown[]).filter((w): w is string => typeof w === "string") });
          set({ linkAnswer: { ok: m.ok === true, ...(typeof m.reason === "string" ? { reason: m.reason } : {}), at: performance.now() } });
          return;
        case "card":
          set({ card: { id: m.id as string, name: nameIn(m), line: m.line as string, stage: m.stage as string, lessons: m.lessons as string, at: performance.now() } });
          return;
        case "proposal":
          set({ proposal: { from: m.from as string, name: nameIn(m), stage: m.stage as string, line: m.line as string, ...(asChain(m.chain) ? { chain: asChain(m.chain)! } : {}), at: performance.now() } });
          return;
        case "answer":
          set({
            answer: {
              from: m.from as string,
              name: nameIn(m),
              yes: m.yes === true,
              ...(typeof m.line === "string" ? { line: m.line } : {}),
              ...(typeof m.stage === "string" ? { stage: m.stage } : {}),
              ...(typeof m.card === "string" ? { card: m.card } : {}),
              ...(asChain(m.chain) ? { chain: asChain(m.chain)! } : {}),
              at: performance.now(),
            },
          });
          return;
        case "asked":
          set({ asked: { name: nameIn(m), at: performance.now() } });
          return;
        case "say": {
          const x = members[m.id as string];
          if (!x) return;
          members[x.id] = { ...x, say: { text: m.text as string, at: performance.now() } };
          return set({ members });
        }
        default:
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      set({ status: "off", members: {} });
      const delay = Math.min(30_000, 1000 * 2 ** retry++);
      setTimeout(open, delay);
    };
  };
  return {
    status: "off",
    space: null,
    members: {},
    incoming: null,
    card: null,
    asked: null,
    homeDecor: null,
    links: null,
    linkAnswer: null,
    decorRefused: null,
    link: (wallet, signature) => send({ t: "link", key: decorKey(), wallet, signature }),
    unlink: (wallet) => send({ t: "unlink", key: decorKey(), wallet }),
    recolour: () => send({ t: "recolour" }),
    shareDecor: (placed) => {
      const next = JSON.stringify(placed);
      if (next === decorShared) return;
      decorShared = next;
      send({ t: "decor", key: decorKey(), placed });
    },
    shareCard: (card) => {
      lessonsCard = card;
      send({ t: "card", lessons: lessonsCard });
    },
    proposal: null,
    answer: null,
    propose: (to, chain) => send({ t: "propose", to, ...(chain ? { chain } : {}) }),
    reply: (to, yes, chain) => {
      send({ t: "answer", to, yes, ...(chain ? { chain } : {}) });
      set({ proposal: null });
    },
    clearFamily: () => set({ proposal: null, answer: null }),
    ask: (id) => send({ t: "ask", to: id }),
    connect: (who, space) => {
      const changed = !me || me.name !== who.name || me.petId !== who.petId || me.line !== who.line || me.stage !== who.stage;
      me = who;
      want = space;
      if (!ws) open();
      // another pet on screen introduces itself again (its name, and its id for the name colour)
      else if (changed) send({ t: "hello", id: playerId(), key: decorKey(), ...me, space });
      else send({ t: "go", space });
    },
    go: (space) => {
      want = space;
      send({ t: "go", space });
    },
    pos: (x) => send({ t: "pos", x }),
    mood: (m) => send({ t: "mood", mood: m }),
    emote: (kind, to) => send({ t: "emote", kind, ...(to ? { to } : {}) }),
    say: (text) => send({ t: "say", text }),
  };
});

export const liveAvailable = () => LIVE_URL !== "";
