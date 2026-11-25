/**
 * Pet letters over TapeRelay (H13, plan 37 section H13). Each player has one TapeRelay user identity on this device,
 * made in the browser the first time letters are needed: no wallet, no gas, no developer key. Its two keys live in
 * `lingxi.letters.v1`, travel in the save file (P1) and never go to our server (a device move leaves them behind).
 *
 * Friends' addresses come with friendship: a pet in a live room shares its owner's address in presence, and a friend's
 * address is recorded and approved on the relay, so only friends' letters get through; a stranger's single first letter
 * waits until the player accepts or ignores it. Letters are sealed and signed on the device and checked on arrival by
 * the relay client; what arrives is kept here, since the relay deletes a letter once read and after 30 days at most.
 * Only the tab that holds the save's one-writer lock reads the inbox (a letter goes to the first reader that marks it).
 *
 * The relay client (about 0.7 MB) is loaded only when letters are first needed.
 */

import { type StoreApi, create } from "zustand";
import { RELAY_NODES, isRelayAddress, readLetter, writeLetter } from "@lingxi/game";
import type { KeyPair, OpenResult, SelfAuth } from "@taperelay/client";
import { saveWrite, useSaveState } from "./saveRuntime";
import { LETTERS_KEY } from "./relayAddress";
import { useLive } from "./live";
import { useFriends } from "./friends";

/** Letters kept on this device, newest first: the oldest beyond this go. */
export const KEPT_MAX = 300;
/** How often the inbox is pulled while the game is open (push brings letters sooner when it connects). */
export const POLL_MS = 30_000;
/** How long after a letter is handed to the relay its delivery is first asked about. */
const STATUS_AFTER_MS = 4_000;
/** Strangers waiting at once; more are dropped (each could only ever send one letter). */
const STRANGERS_MAX = 20;

export type LetterState = "sending" | "waiting" | "delivered" | "failed";

/** A letter kept on this device. */
export interface KeptLetter {
  /** the relay's id for it (a 64-hex digest), or a local id while it is still being sent */
  id: string;
  dir: "in" | "out";
  /** the friend's player id and pet */
  player: string;
  pet: string;
  /** the pet of ours it was to or from */
  myPet: string;
  text: string;
  at: number;
  /** for a letter sent: where it stands */
  state?: LetterState;
  /** for a letter sent: the node that took it, to ask about its delivery */
  server?: string;
}

/** Someone not yet a friend who wrote once: their letter waits to be accepted or ignored. */
export interface Stranger {
  address: string;
  player: string;
  pet: string;
  myPet: string;
  text: string;
  at: number;
}

interface Saved {
  v: 1;
  account: string;
  privateKey: string;
  secretKey: string;
  /** addresses approved on the relay */
  allowed: string[];
  /** friends' addresses, by player id */
  book: Record<string, string>;
  kept: KeptLetter[];
  strangers: Stranger[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const PLAYER = /^[a-z0-9]{6,32}$/;
const isKept = (l: unknown): l is KeptLetter => {
  const k = l as KeptLetter;
  return (
    !!k &&
    typeof k.id === "string" &&
    (k.dir === "in" || k.dir === "out") &&
    typeof k.player === "string" &&
    typeof k.pet === "string" &&
    typeof k.text === "string" &&
    typeof k.at === "number"
  );
};

/** What is kept, or null for none or a copy this build cannot read. */
function load(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(LETTERS_KEY) ?? "null") as Partial<Saved> | null;
    if (
      !v ||
      v.v !== 1 ||
      !isRelayAddress(v.account) ||
      !HEX64.test(v.privateKey ?? "") ||
      !HEX64.test(v.secretKey ?? "")
    )
      return null;
    const book = Object.fromEntries(
      Object.entries(v.book ?? {}).filter(([p, a]) => PLAYER.test(p) && isRelayAddress(a)),
    );
    return {
      v: 1,
      account: v.account,
      privateKey: v.privateKey!,
      secretKey: v.secretKey!,
      allowed: (v.allowed ?? []).filter(isRelayAddress),
      book,
      kept: (v.kept ?? []).filter(isKept).slice(0, KEPT_MAX),
      strangers: (v.strangers ?? []).filter((s) => isRelayAddress(s?.address)).slice(0, STRANGERS_MAX),
    };
  } catch {
    return null;
  }
}

const persist = (s: Saved) => {
  try {
    saveWrite(LETTERS_KEY, JSON.stringify(s));
  } catch {
    // private mode: kept for this visit
  }
};

type Lib = typeof import("@taperelay/client");
let libLoading: Promise<Lib> | null = null;
const lib = () => (libLoading ??= import("@taperelay/client"));
const now = () => Math.floor(Date.now() / 1000);
const http = (url: string, init?: RequestInit) => fetch(url, init);

interface Session {
  account: string;
  auth: SelfAuth;
  keys: KeyPair;
  /** the node to talk to (host:port) */
  node: string;
}
let session: Session | null = null;
/** The identity being opened or made: every caller at the same moment waits on the one attempt, so exactly one is made. */
let opening: Promise<Session | null> | null = null;

/** A browser message the player never sees as such: an error said plainly by kind. */
export type LettersTrouble = "down" | "noKey" | "tooFast" | "refused";
const troubleOf = (e: unknown): LettersTrouble => {
  const code = String((e as { code?: unknown })?.code ?? "");
  const msg = String((e as { message?: unknown })?.message ?? "");
  if (code === "no-encryption-key") return "noKey";
  if (code === "rate-limited" || code === "http-429" || /HTTP 429/.test(msg)) return "tooFast";
  if (
    code === "unreachable" ||
    e instanceof TypeError ||
    /failed to fetch|load failed|networkerror|timeout|abort/i.test(msg)
  )
    return "down";
  return "refused";
};

interface LettersStore {
  saved: Saved | null;
  /** "down" when the relay could not be reached the last time it was asked; cleared by the next success */
  trouble: LettersTrouble | null;
  receiving: boolean;
  /** makes this player's identity if there is none yet (the first time letters are needed) */
  ensure: () => Promise<Session | null>;
  /** a friend's address, from a live room: recorded and approved on the relay */
  learnFriend: (player: string, address: string) => Promise<void>;
  send: (
    to: { player: string; pet: string },
    myPet: string,
    fromPlayer: string,
    text: string,
  ) => Promise<{ ok: true } | { ok: false; reason: "empty" | "tooLong" | "noAddress" | LettersTrouble }>;
  retry: (id: string, fromPlayer: string) => Promise<void>;
  /** reads the inbox once (only in the tab that holds the save) */
  pull: () => Promise<void>;
  /** starts receiving: now, every POLL_MS, and by push */
  startReceiving: () => void;
  stopReceiving: () => void;
  accept: (address: string) => Promise<void>;
  ignore: (address: string) => Promise<void>;
}

let poll: ReturnType<typeof setInterval> | null = null;
let stopPush: (() => void) | null = null;

/**
 * What the letters store does for itself, beneath its actions (P7: out of the store's body): saving what it keeps,
 * clearing a passed trouble, taking in an arrived letter, marking letters read, checking and making a delivery,
 * allowing a sender, and opening this device's mail session.
 */
function lettersInternals(set: StoreApi<LettersStore>["setState"], get: () => LettersStore) {
  const write = (next: Saved) => {
    persist(next);
    set({ saved: next });
  };
  const ok = () => get().trouble !== null && set({ trouble: null });

  /** A letter that opened and verified: kept from a friend, or waiting as a stranger's. */
  const arrived = (m: OpenResult, myPetOf: (toPet: string) => string) => {
    const s = get().saved;
    if (!s || !m.ok) return;
    const r = readLetter(m.text);
    if (!r.ok || s.kept.some((k) => k.id === m.id)) return;
    const { letter } = r;
    const friend = s.book[letter.from.player] === m.from;
    const at = (m.createdAt || now()) * 1000;
    if (friend) {
      const kept: KeptLetter = {
        id: m.id,
        dir: "in",
        player: letter.from.player,
        pet: letter.from.pet,
        myPet: myPetOf(letter.toPet),
        text: letter.text,
        at,
      };
      write({ ...s, kept: [kept, ...s.kept].slice(0, KEPT_MAX) });
    } else if (!s.strangers.some((x) => x.address === m.from)) {
      const stranger: Stranger = {
        address: m.from,
        player: letter.from.player,
        pet: letter.from.pet,
        myPet: myPetOf(letter.toPet),
        text: letter.text,
        at,
      };
      write({ ...s, strangers: [stranger, ...s.strangers].slice(0, STRANGERS_MAX) });
    }
  };

  const markRead = async (ids: string[]) => {
    if (!ids.length || !session) return;
    const { createClient } = await lib();
    await createClient()
      .markRead(session.node, session.auth, ids.slice(0, 100))
      .catch(() => {});
  };

  /** Asks the relay where a sent letter stands. */
  const checkDelivery = async (id: string) => {
    const s = get().saved;
    const l = s?.kept.find((k) => k.id === id);
    if (!s || !l?.server || l.state === "delivered" || l.state === "failed") return;
    try {
      const { createClient, deliveryStatus } = await lib();
      const st = await deliveryStatus(createClient(), l.server, id);
      const state: LetterState =
        st.status === "delivered" ? "delivered" : st.status === "failed" ? "failed" : "waiting";
      if (state !== l.state)
        write({ ...get().saved!, kept: get().saved!.kept.map((k) => (k.id === id ? { ...k, state } : k)) });
    } catch {
      // a node that deletes a letter once delivered no longer knows it: it was delivered
      write({
        ...get().saved!,
        kept: get().saved!.kept.map((k) => (k.id === id && k.state === "waiting" ? { ...k, state: "delivered" } : k)),
      });
    }
  };

  /** Seals, signs and hands a letter to the relay; the kept copy says where it stands. */
  const deliver = async (
    localId: string,
    address: string,
    body: string,
  ): Promise<{ ok: true } | { ok: false; reason: LettersTrouble }> => {
    try {
      const me = await get().ensure();
      if (!me) return { ok: false, reason: "down" };
      const t = await lib();
      const { key } = await t.fetchSelfKey(http, address);
      await allow(address);
      const notice = t.makeSelfNotice({
        from: me.account,
        to: address,
        message: body,
        recipientKey: key,
        ownKey: me.keys,
        createdAt: now(),
      });
      const sent = await t.submitSelfNotice(http, me.auth, await t.signSelfNotice(me.auth, notice), { now: now() });
      const s = get().saved!;
      write({
        ...s,
        kept: s.kept.map((k) => (k.id === localId ? { ...k, id: sent.id, server: sent.server, state: "waiting" } : k)),
      });
      ok();
      setTimeout(() => void checkDelivery(sent.id), STATUS_AFTER_MS);
      return { ok: true };
    } catch (e) {
      const reason = troubleOf(e);
      const s = get().saved;
      if (s) write({ ...s, kept: s.kept.map((k) => (k.id === localId ? { ...k, state: "failed" } : k)) });
      if (reason === "down") set({ trouble: "down" });
      return { ok: false, reason };
    }
  };

  /** Approves an address on the relay once, so its letters get through. */
  const allow = async (address: string) => {
    const s = get().saved;
    if (!s || s.allowed.includes(address) || !session) return;
    const t = await lib();
    await t.updateSenders(http, session.auth, { allow: [address], now: now() });
    write({ ...get().saved!, allowed: [...get().saved!.allowed, address] });
  };

  /** Opens this player's identity, making and publishing it the first time (only ever called through ensure). */
  const open = async (): Promise<Session | null> => {
    try {
      const t = await lib();
      let s = get().saved;
      if (!s) {
        // a new identity on one of the official nodes, with its encryption key published so friends can write
        const host = RELAY_NODES[Math.floor(Math.random() * RELAY_NODES.length)]!;
        const id = t.newSelfIdentity({ host });
        const kp = t.generateKeyPair();
        await t.publishSelfKey(http, t.selfAuth(id.privateKey, host), kp.publicKey, { now: now() });
        s = {
          v: 1,
          account: id.account,
          privateKey: t.hex(id.privateKey),
          secretKey: t.hex(kp.secretKey),
          allowed: [],
          book: {},
          kept: [],
          strangers: [],
        };
        write(s);
        // the pets in the room learn the new address, so a friend there can write back
        useLive.getState().shareRelay(id.account);
      }
      const host = s.account.slice(s.account.indexOf("@") + 1);
      const privateKey = t.fromHex(s.privateKey);
      const secretKey = t.fromHex(s.secretKey);
      session = {
        account: s.account,
        auth: t.selfAuth(privateKey, host),
        keys: { secretKey, publicKey: t.publicKeyOf(secretKey) },
        node: t.nodeOf(s.account),
      };
      ok();
      return session;
    } catch (e) {
      if (troubleOf(e) === "down") set({ trouble: "down" });
      return null;
    }
  };
  return { write, ok, arrived, markRead, checkDelivery, deliver, allow, open };
}

export const useLetters = create<LettersStore>((set, get) => {
  const { write, ok, arrived, markRead, checkDelivery, deliver, allow, open } = lettersInternals(set, get);
  return {
    saved: load(),
    trouble: null,
    receiving: false,

    ensure: () => {
      if (session) return Promise.resolve(session);
      opening ??= open().finally(() => {
        opening = null;
      });
      return opening;
    },

    learnFriend: async (player, address) => {
      if (!PLAYER.test(player) || !isRelayAddress(address)) return;
      const s = get().saved;
      if (s?.book[player] === address && s.allowed.includes(address)) return;
      if (!(await get().ensure())) return;
      write({ ...get().saved!, book: { ...get().saved!.book, [player]: address } });
      await allow(address).catch((e) => troubleOf(e) === "down" && set({ trouble: "down" }));
    },

    send: async (to, myPet, fromPlayer, text) => {
      const w = writeLetter({ from: { pet: myPet, player: fromPlayer }, toPet: to.pet, text });
      if (!w.ok) return { ok: false, reason: w.reason };
      const address = get().saved?.book[to.player];
      if (!address) return { ok: false, reason: "noAddress" };
      const localId = `local-${crypto.randomUUID()}`;
      const s = get().saved!;
      const kept: KeptLetter = {
        id: localId,
        dir: "out",
        player: to.player,
        pet: to.pet,
        myPet,
        text: text.trim(),
        at: Date.now(),
        state: "sending",
      };
      write({ ...s, kept: [kept, ...s.kept].slice(0, KEPT_MAX) });
      return deliver(localId, address, w.body);
    },

    retry: async (id, fromPlayer) => {
      const s = get().saved;
      const l = s?.kept.find((k) => k.id === id && k.dir === "out" && k.state === "failed");
      const address = l && s?.book[l.player];
      if (!s || !l || !address) return;
      const w = writeLetter({ from: { pet: l.myPet, player: fromPlayer }, toPet: l.pet, text: l.text });
      if (!w.ok) return;
      const localId = `local-${crypto.randomUUID()}`;
      write({
        ...s,
        kept: s.kept.map((k) => (k.id === id ? { ...k, id: localId, state: "sending", at: Date.now() } : k)),
      });
      await deliver(localId, address, w.body);
    },

    pull: async () => {
      if (useSaveState.getState().role !== "writer" || !get().saved) return;
      const me = await get().ensure();
      if (!me) return;
      try {
        const t = await lib();
        const client = t.createClient();
        let cursor: string | undefined;
        do {
          const page = await client.inbox(me.node, me.auth, { ...(cursor ? { cursor } : {}), limit: 100 });
          const ids: string[] = [];
          for (const it of page.items ?? []) {
            ids.push(it.id);
            if (!it.read) arrived(t.openSelfNotice(it, me.keys, { me: me.account }), (toPet) => toPet);
          }
          // read and kept (or not readable at all): the relay may delete it now
          await markRead(ids);
          cursor = page.next;
        } while (cursor);
        // the letters still on their way are asked about again
        for (const l of get().saved?.kept ?? []) if (l.dir === "out" && l.state === "waiting") void checkDelivery(l.id);
        ok();
      } catch (e) {
        if (troubleOf(e) === "down") set({ trouble: "down" });
      }
    },

    startReceiving: () => {
      if (get().receiving || !get().saved) return;
      set({ receiving: true });
      void get().pull();
      poll = setInterval(() => void get().pull(), POLL_MS);
      void (async () => {
        const me = await get().ensure();
        if (!me || !get().receiving || useSaveState.getState().role !== "writer") return;
        const t = await lib();
        stopPush = t.subscribeNotices(http, me.auth, {
          keyPair: me.keys,
          now,
          onNotice: (m) => {
            arrived(m, (toPet) => toPet);
            void markRead([m.id]);
          },
          // a letter that does not check out is skipped and marked read; a dropped push leaves the 30-second pull
          onError: (e) => void (e.item ? markRead([e.item.id]) : null),
        });
      })();
    },

    stopReceiving: () => {
      if (poll) clearInterval(poll);
      poll = null;
      stopPush?.();
      stopPush = null;
      set({ receiving: false });
    },

    accept: async (address) => {
      const s = get().saved;
      const st = s?.strangers.find((x) => x.address === address);
      if (!s || !st) return;
      if (!(await get().ensure())) return;
      await allow(address);
      const after = get().saved!;
      const kept: KeptLetter = {
        id: `from-${address}-${st.at}`,
        dir: "in",
        player: st.player,
        pet: st.pet,
        myPet: st.myPet,
        text: st.text,
        at: st.at,
      };
      write({
        ...after,
        book: { ...after.book, [st.player]: address },
        kept: [kept, ...after.kept].slice(0, KEPT_MAX),
        strangers: after.strangers.filter((x) => x.address !== address),
      });
    },

    ignore: async (address) => {
      const s = get().saved;
      if (!s) return;
      write({ ...s, strangers: s.strangers.filter((x) => x.address !== address) });
      const me = await get().ensure();
      if (me) await (await lib()).updateSenders(http, me.auth, { deny: [address], now: now() }).catch(() => {});
    },
  };
});

/** Friends' pets the active pet can write to: a friendship and a known address. */
export const writableFriends = (
  bonds: Record<string, { name: string }>,
  book: Record<string, string>,
): Array<{ player: string; pet: string }> =>
  Object.keys(bonds)
    .map((k) => ({ player: k.slice(0, k.indexOf(":")), pet: bonds[k]!.name }))
    .filter((f) => PLAYER.test(f.player) && !!book[f.player]);

/**
 * Keeps letters going while the game is open: a friend's pet in a live room hands over its owner's address, which is
 * recorded and approved; and once this player has an identity, the inbox is read on load, every POLL_MS and by push,
 * by the tab that holds the save. Returns a stop.
 */
export function watchLetters(): () => void {
  const isFriend = (player: string) =>
    Object.values(useFriends.getState().all).some((bonds) =>
      Object.keys(bonds).some((k) => k.startsWith(`${player}:`)),
    );
  const learn = () => {
    for (const m of Object.values(useLive.getState().members))
      if (m.relay && isFriend(m.id)) void useLetters.getState().learnFriend(m.id, m.relay);
  };
  const receive = () => {
    const l = useLetters.getState();
    if (l.saved && useSaveState.getState().role === "writer") l.startReceiving();
    else if (useSaveState.getState().role !== "writer") l.stopReceiving();
  };
  learn();
  receive();
  const stops = [
    useLive.subscribe(learn),
    useFriends.subscribe(learn),
    useSaveState.subscribe(receive),
    useLetters.subscribe((s, prev) => s.saved !== null && prev.saved === null && receive()),
  ];
  return () => {
    for (const stop of stops) stop();
    useLetters.getState().stopReceiving();
  };
}
