/**
 * Live presence in the browser: one WebSocket to our server, the space we are
 * in (the world room, our home, or a friend's home we are visiting), and the
 * other pets there. Reconnects with backoff; quietly does nothing when the
 * server is not configured (the DeWEB build).
 */

import { create } from "zustand";

const LIVE_URL = (import.meta.env.VITE_LIVE_URL as string | undefined) ?? (location.hostname === "localhost" ? "ws://localhost:8787/live" : "");
const PLAYER_KEY = "lingxi.player.v1";

export function playerId(): string {
  try {
    const saved = localStorage.getItem(PLAYER_KEY);
    if (saved && /^[a-z0-9]{12,32}$/.test(saved)) return saved;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(PLAYER_KEY, id);
    return id;
  } catch {
    return "guest" + Math.random().toString(16).slice(2, 14);
  }
}

/** A friend's home we arrived at through an invite link (?visit=<id>). */
export function visitingFrom(search = location.search): string | null {
  const v = new URLSearchParams(search).get("visit");
  return v && /^[a-z0-9]{12,32}$/.test(v) && v !== playerId() ? v : null;
}

export interface LiveMember {
  id: string;
  name: string;
  line: string;
  stage: string;
  mood: number;
  x: number;
  emote?: { kind: string; at: number };
  say?: { text: string; at: number };
}

interface Me {
  name: string;
  line: string;
  stage: string;
  mood: number;
}

interface LiveState {
  status: "off" | "connecting" | "on";
  space: string | null;
  members: Record<string, LiveMember>;
  /** last emote others sent to us, for the scene */
  incoming: { from: string; kind: string; at: number } | null;
  /** a friend's pet card we asked for, to spar against */
  card: { id: string; name: string; line: string; stage: string; lessons: string; at: number } | null;
  /** someone just sparred against our pet */
  asked: { name: string; at: number } | null;
  shareLessons: (lessons: unknown[]) => void;
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
      send({ t: "hello", id: playerId(), ...me, space: want });
      if (lessonsCard) send({ t: "card", lessons: lessonsCard });
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
        case "room":
          set({ space: m.space as string, members: Object.fromEntries((m.members as LiveMember[]).map((x) => [x.id, x])) });
          return;
        case "joined": {
          const x = m.member as LiveMember;
          members[x.id] = x;
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
        case "card":
          set({ card: { id: m.id as string, name: m.name as string, line: m.line as string, stage: m.stage as string, lessons: m.lessons as string, at: performance.now() } });
          return;
        case "asked":
          set({ asked: { name: m.name as string, at: performance.now() } });
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
    shareLessons: (lessons) => {
      lessonsCard = JSON.stringify(lessons);
      send({ t: "card", lessons: lessonsCard });
    },
    ask: (id) => send({ t: "ask", to: id }),
    connect: (who, space) => {
      me = who;
      want = space;
      if (!ws) open();
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
