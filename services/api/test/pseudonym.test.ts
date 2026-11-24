/**
 * P6a: no store writes a player's network address to disk. Each keeps a keyed code of the address and of its IPv6 /48
 * (src/pseudonym.ts), its shares count exactly as they did on addresses, and a store kept before is coded on its first
 * open, the .bak it keeps and the files it set aside included, with the shares it counted still counting.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PET_SCHOOL, petCard } from "@lingxi/game";
import { signSponsorRequest } from "@lingxi/chain";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  CODE,
  addressCode,
  codeOf,
  heldOverCoded,
  networkCode,
  prefixCode,
  pseudonym,
  pseudonymKey,
  scrubText,
} from "../src/pseudonym";
import { heldOver, prefixOf } from "../src/limit";
import { MAX_PER_ADDRESS, createAgentStore } from "../src/agents";
import { createArenaStore } from "../src/arena";
import { MAX_ENTRIES_PER_ADDRESS, createSeasonStore } from "../src/season";
import { createSittingStore, keyHashOf } from "../src/sitting";
import { createLibrary, hashId, lessonKey } from "../src/library";
import { addSeen, emptySeen } from "../src/seenSet";
import { createTokenBudget } from "../src/tokenBudget";
import { SponsorGate } from "../src/sponsor";
import { MAX_DEVICES_PER_ADDRESS, createPusher, type Plan } from "../src/push";
import { createDuelStore } from "../src/duels";

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const IPV6 = /\b[0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f:]*/i;
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `lx-p6a-${name}-`));

/** every file under `path` (names and contents), for an address written anywhere in it */
function addressesIn(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) {
    const text = readFileSync(path, "utf8");
    return [path, text].flatMap((t) => [...(IPV4.exec(t) ?? []), ...(IPV6.exec(t) ?? [])]);
  }
  return readdirSync(path).flatMap((n) => [
    ...(IPV4.exec(n) ?? []),
    ...(IPV6.exec(n) ?? []),
    ...addressesIn(join(path, n)),
  ]);
}

/** the /64s of one IPv6 /48, as clientIp names them */
const sixtyFours = (n: number, net = "2001:db8:7") =>
  Array.from({ length: n }, (_, i) => `${net}:${i.toString(16)}::/64`);

describe("the address code (P6a)", () => {
  it("gives one address one code under one key, and another under another key", () => {
    const a = Buffer.alloc(32, 1);
    const b = Buffer.alloc(32, 2);
    expect(addressCode("203.0.113.9", a)).toBe(addressCode("203.0.113.9", a));
    expect(addressCode("203.0.113.9", a)).toMatch(CODE);
    expect(addressCode("203.0.113.9", a)).not.toBe(addressCode("203.0.113.9", b));
    expect(addressCode("203.0.113.9", a)).not.toBe(addressCode("203.0.113.10", a));
    // an address and a network never share a code by being the same text
    expect(pseudonym("address", "x", a)).not.toBe(pseudonym("network", "x", a));
  });

  it("gives two /64s of one /48 one network code, and an IPv4 address none", () => {
    expect(networkCode("2001:db8:7:1::/64")).toBe(networkCode("2001:db8:7:ffff::/64"));
    expect(networkCode("2001:db8:7:1::/64")).toBe(prefixCode("2001:db8:7::/48"));
    expect(networkCode("2001:db8:8:1::/64")).not.toBe(networkCode("2001:db8:7:1::/64"));
    expect(addressCode("2001:db8:7:1::/64")).not.toBe(addressCode("2001:db8:7:2::/64"));
    expect(networkCode("203.0.113.9")).toBeNull();
    expect(codeOf("203.0.113.9")).toEqual({ by: addressCode("203.0.113.9") });
  });

  it("counts shares on codes exactly as heldOver counts them on addresses", () => {
    const callers = ["203.0.113.9", "203.0.113.9", "198.51.100.1", ...sixtyFours(11), "2001:db8:9:1::/64"];
    for (const who of [
      "203.0.113.9",
      "198.51.100.1",
      "2001:db8:7:0::/64",
      "2001:db8:7:42::/64",
      "2001:db8:9:1::/64",
      "local",
    ])
      for (const cap of [1, 2, 3])
        for (let n = 0; n <= callers.length; n++)
          expect(heldOverCoded(callers.slice(0, n).map(codeOf), codeOf(who), cap), `${who} cap ${cap} n ${n}`).toBe(
            heldOver(callers.slice(0, n), who, cap),
          );
  });

  it("makes its key once, 32 random bytes kept to this user, and refuses a file that holds no key", () => {
    const dir = tmp("key");
    const file = join(dir, "deep", "ip-key");
    const key = pseudonymKey(file);
    expect(key.length).toBe(32);
    expect(readFileSync(file, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(pseudonymKey(file).equals(key)).toBe(true);
    const other = join(dir, "ip-key-2");
    expect(pseudonymKey(other).equals(key), "another file, another key").toBe(false);
    const bad = join(dir, "bad-key");
    writeFileSync(bad, "not a key");
    expect(() => pseudonymKey(bad)).toThrow(/does not hold an address key/);
    expect(readFileSync(bad, "utf8"), "a file that holds no key is left as it is").toBe("not a key");
  });

  it("scrubs every raw caller written in a JSON text, and nothing else", () => {
    const text = JSON.stringify({
      a: "203.0.113.9",
      b: "2001:db8:7:1::/64",
      c: "2001:db8:7::/48",
      d: "v1.2.3",
      e: "999.1.1.1x",
      n: 12,
    });
    const clean = scrubText(text);
    expect(clean).not.toMatch(IPV4);
    expect(clean).not.toMatch(IPV6);
    expect(JSON.parse(clean)).toEqual({
      a: addressCode("203.0.113.9"),
      b: addressCode("2001:db8:7:1::/64"),
      c: prefixCode("2001:db8:7::/48"),
      d: "v1.2.3",
      e: "999.1.1.1x",
      n: 12,
    });
  });
});

describe("agent pets keep a code of the adopting address (P6a)", () => {
  const adopt = (s: ReturnType<typeof createAgentStore>, i: number, from: string) =>
    s.adopt(`agent-${i}`, `Pet${i}`, "gentle", 0, from);

  it("writes no address, and holds an address and a /48 to their shares as before, across a restart", () => {
    const file = join(tmp("agents"), "agents.json");
    const s = createAgentStore(file);
    for (let i = 0; i < MAX_PER_ADDRESS; i++) expect(adopt(s, i, "203.0.113.5").ok).toBe(true);
    expect(adopt(s, 99, "203.0.113.5")).toMatchObject({ ok: false, reason: "tooMany" });
    let network = 0;
    for (const [i, a] of sixtyFours(40).entries()) if (adopt(s, 100 + i, a).ok) network++;
    expect(network).toBe(MAX_PER_ADDRESS * 4);
    expect(addressesIn(join(file, ".."))).toEqual([]);
    const again = createAgentStore(file);
    expect(adopt(again, 200, "203.0.113.5")).toMatchObject({ ok: false, reason: "tooMany" });
    expect(adopt(again, 201, "2001:db8:7:ff::/64")).toMatchObject({ ok: false, reason: "tooMany" });
    expect(adopt(again, 202, "198.51.100.1").ok).toBe(true);
  });

  it("codes the addresses of pets kept before, its .bak and the copies set aside too, and they still count", () => {
    const dir = tmp("agents-old");
    const file = join(dir, "agents.json");
    const s = createAgentStore(file);
    for (let i = 0; i < MAX_PER_ADDRESS; i++) adopt(s, i, "203.0.113.5");
    // the file as a store before P6a wrote it: the adopter's address as it is
    const old = JSON.parse(readFileSync(file, "utf8")) as Record<string, { from?: string; net?: string }>;
    for (const k of Object.values(old)) {
      k.from = "203.0.113.5";
      delete k.net;
    }
    writeFileSync(file, JSON.stringify(old));
    writeFileSync(`${file}.bak`, JSON.stringify(old));
    writeFileSync(`${file}.damaged-1`, `${JSON.stringify(old).slice(0, 200)}`);
    expect(addressesIn(dir).length).toBeGreaterThan(0);
    const again = createAgentStore(file);
    expect(addressesIn(dir), "no address survives the first open").toEqual([]);
    expect(adopt(again, 50, "203.0.113.5"), "the pets kept before still count against their address").toMatchObject({
      ok: false,
      reason: "tooMany",
    });
    expect(
      Object.values(JSON.parse(readFileSync(file, "utf8")) as Record<string, { from: string }>).every(
        (k) => k.from === addressCode("203.0.113.5"),
      ),
    ).toBe(true);
  });
});

describe("arena lines keep a code of the sending address (P6a)", () => {
  const pet = {
    name: "Mochi",
    line: "gentle",
    stage: "child",
    card: petCard({ lessons: [] }),
    story: { days: 3, lessons: 0, nature: [] },
  };
  const device = (i: number) => `device-${String(i).padStart(8, "0")}`;

  it("writes no address, and holds a sender to two lines a round and a /48 to eight, across a restart", async () => {
    const file = join(tmp("arena"), "arena.json");
    const s = createArenaStore(file, Date.now, { every: 0 });
    expect(s.save(3, pet, [], device(1), "203.0.113.5")).toEqual({ ok: true });
    expect(s.save(3, pet, [], device(2), "203.0.113.5")).toEqual({ ok: true });
    expect(s.save(3, pet, [], device(3), "203.0.113.5")).toEqual({ ok: false, reason: "busy" });
    let network = 0;
    for (const [i, a] of sixtyFours(20).entries()) if (s.save(3, pet, [], device(100 + i), a).ok) network++;
    expect(network).toBe(8);
    await s.flush();
    expect(addressesIn(join(file, ".."))).toEqual([]);
    const again = createArenaStore(file, Date.now, { every: 0 });
    expect(again.save(3, pet, [], device(4), "203.0.113.5")).toEqual({ ok: false, reason: "busy" });
    expect(again.save(3, pet, [], device(200), "2001:db8:7:ff::/64")).toEqual({ ok: false, reason: "busy" });
  });

  it("codes the senders of lines kept before, in its rounds and in the old file it moved out of", () => {
    const dir = tmp("arena-old");
    const file = join(dir, "arena.json");
    const line = (by: string, from: string) => ({ pet, team: [], by, at: 1, from });
    // the old single file, moved in on open and set aside as .before-rounds
    writeFileSync(file, JSON.stringify({ 5: [line("a".repeat(16), "203.0.113.5")] }));
    mkdirSync(`${file}.d`, { recursive: true });
    writeFileSync(
      join(`${file}.d`, "3.json"),
      JSON.stringify([line("b".repeat(16), "203.0.113.5"), line("c".repeat(16), "203.0.113.5")]),
    );
    writeFileSync(join(`${file}.d`, "3.json.bak"), JSON.stringify([line("b".repeat(16), "203.0.113.5")]));
    const s = createArenaStore(file, Date.now, { every: 0 });
    expect(addressesIn(dir), "no address survives the first open").toEqual([]);
    expect(existsSync(`${file}.before-rounds`)).toBe(true);
    expect(s.save(3, pet, [], device(9), "203.0.113.5"), "lines kept before still count against their sender").toEqual({
      ok: false,
      reason: "busy",
    });
    expect(s.save(5, pet, [], device(9), "203.0.113.5")).toEqual({ ok: true });
    expect(s.save(5, pet, [], device(10), "203.0.113.5")).toEqual({ ok: false, reason: "busy" });
  });
});

describe("season entries keep a code of the entering address (P6a)", () => {
  const T = Date.UTC(2026, 10, 18, 12);
  const pet = (name: string) => ({
    name,
    line: "gentle",
    stage: "child",
    card: petCard({ lessons: [] }),
    story: { days: 1, lessons: 0, nature: [] },
  });
  const device = (i: number) => `device-${String(i).padStart(8, "0")}`;

  it("writes no address, and holds an address and a /48 to their entries as before, across a restart", () => {
    const file = join(tmp("season"), "season.json");
    const s = createSeasonStore(file, () => T);
    for (let i = 0; i < MAX_ENTRIES_PER_ADDRESS; i++)
      expect(s.enter(pet(`P${i}`), device(i), { from: "203.0.113.5" }).ok).toBe(true);
    expect(s.enter(pet("P9"), device(9), { from: "203.0.113.5" })).toEqual({ ok: false, reason: "tooMany" });
    let network = 0;
    for (const [i, a] of sixtyFours(30).entries())
      if (s.enter(pet(`N${i}`), device(100 + i), { from: a }).ok) network++;
    expect(network).toBe(MAX_ENTRIES_PER_ADDRESS * 4);
    expect(addressesIn(join(file, ".."))).toEqual([]);
    const again = createSeasonStore(file, () => T);
    expect(again.enter(pet("Q"), device(300), { from: "203.0.113.5" })).toEqual({ ok: false, reason: "tooMany" });
    expect(again.enter(pet("R"), device(301), { from: "2001:db8:7:ff::/64" })).toEqual({
      ok: false,
      reason: "tooMany",
    });
    expect(again.enter(pet("S"), device(302), { from: "198.51.100.1" }).ok).toBe(true);
  });

  it("codes the entrants of weeks kept before, and they still count", () => {
    const dir = tmp("season-old");
    const file = join(dir, "season.json");
    const s = createSeasonStore(file, () => T);
    for (let i = 0; i < MAX_ENTRIES_PER_ADDRESS; i++) s.enter(pet(`P${i}`), device(i), { from: "2001:db8:7:1::/64" });
    const [week] = readdirSync(`${file}.d`).filter((n) => n.endsWith(".json"));
    const path = join(`${file}.d`, week!);
    const old = JSON.parse(readFileSync(path, "utf8")) as {
      from: Record<string, string>;
      net?: Record<string, string>;
    };
    for (const k of Object.keys(old.from)) old.from[k] = "2001:db8:7:1::/64";
    delete old.net;
    writeFileSync(path, JSON.stringify(old));
    writeFileSync(`${path}.bak`, JSON.stringify(old));
    const again = createSeasonStore(file, () => T);
    expect(addressesIn(dir), "no address survives the first open").toEqual([]);
    expect(again.enter(pet("Q"), device(50), { from: "2001:db8:7:1::/64" })).toEqual({ ok: false, reason: "tooMany" });
    // the /48 they came from was coded too: its other /64s count those entries
    let network = 0;
    for (const [i, a] of sixtyFours(30).entries())
      if (again.enter(pet(`N${i}`), device(100 + i), { from: a }).ok) network++;
    expect(network).toBe(MAX_ENTRIES_PER_ADDRESS * 4 - MAX_ENTRIES_PER_ADDRESS);
  });
});

describe("sitting packs keep a code of the owner's address (P6a)", () => {
  const KEY = "c".repeat(32);
  const pack = JSON.stringify({ v: 1, pet: { bornAt: 1 } });
  const t = 1_800_000_000_000;
  const limits = { maxBytes: 1_000_000, perOwner: 3, freeShare: 1 };

  it("writes no address, and holds an owner and a /48 to their packs as before, across a restart", async () => {
    const dir = join(tmp("sitting"), "sitting");
    const s = createSittingStore(dir, () => t, limits);
    for (let i = 0; i < 3; i++)
      expect((await s.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.5")).ok).toBe(true);
    expect(await s.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.5")).toEqual({
      ok: false,
      reason: "tooMany",
    });
    let network = 0;
    for (const a of sixtyFours(20)) if ((await s.leave(pack, keyHashOf(KEY), t + 86_400_000, a)).ok) network++;
    expect(network).toBe(12);
    expect(addressesIn(dir)).toEqual([]);
    const again = createSittingStore(dir, () => t, limits);
    expect(await again.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.5")).toEqual({
      ok: false,
      reason: "tooMany",
    });
    expect(await again.leave(pack, keyHashOf(KEY), t + 86_400_000, "2001:db8:7:ff::/64")).toEqual({
      ok: false,
      reason: "tooMany",
    });
  });

  it("codes the owners of an index kept before, its .bak too, and they still count", async () => {
    const dir = join(tmp("sitting-old"), "sitting");
    const s = createSittingStore(dir, () => t, limits);
    for (let i = 0; i < 3; i++) await s.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.5");
    const index = join(dir, "index.json");
    const old = JSON.parse(readFileSync(index, "utf8")) as Record<string, { owner: string; net?: string }>;
    for (const e of Object.values(old)) e.owner = "203.0.113.5";
    writeFileSync(index, JSON.stringify(old));
    writeFileSync(`${index}.bak`, JSON.stringify(old));
    const again = createSittingStore(dir, () => t, limits);
    expect(
      await again.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.5"),
      "packs kept before still count",
    ).toEqual({ ok: false, reason: "tooMany" });
    expect(addressesIn(dir), "no address survives the first open").toEqual([]);
  });
});

describe("the lesson library keys its players' ids (P6a)", () => {
  const rule = PET_SCHOOL[0]!.rule;
  const key = lessonKey(rule);
  const plainId = (who: string) =>
    createHash("sha256")
      .update(`lingxi-library:${prefixOf(who) ?? who}`)
      .digest("hex")
      .slice(0, 16);

  it("keeps no id anyone could work out from a guessed address", () => {
    expect(hashId("203.0.113.5")).not.toBe(plainId("203.0.113.5"));
    expect(hashId("203.0.113.5")).toMatch(CODE);
    expect(hashId("2001:db8:7:1::/64"), "a /48 is one player").toBe(hashId("2001:db8:7:2::/64"));
  });

  it("keys the ids of lessons kept before, and the players they counted still count once", () => {
    const file = join(tmp("library"), "library.json");
    const many = Array.from({ length: 300 }, (_, i) => `198.51.${i >> 8}.${i & 255}`);
    // a lesson kept before P6a: plain ids, its users past the exact list (a filter)
    let users = emptySeen();
    for (const w of many) users = addSeen(users, plainId(w));
    const old = [
      {
        key,
        rule,
        by: "Bao",
        firstAt: 1,
        uses: many.length,
        reports: { ids: [plainId("203.0.113.5")], bloom: null },
        reportCount: 1,
        users,
        from: plainId(many[0]!),
        lastAt: 1,
      },
    ];
    writeFileSync(file, JSON.stringify(old));
    const lib = createLibrary(file);
    const saved = JSON.parse(readFileSync(file, "utf8")) as Array<{
      from: string;
      reports: { ids: string[] };
      ids: string;
      users: { legacy?: boolean };
    }>;
    expect(saved[0]!.from).toBe(hashId(many[0]!));
    expect(saved[0]!.reports.ids).toEqual([hashId("203.0.113.5")]);
    expect(saved[0]!.ids).toBe("keyed");
    expect(saved[0]!.users.legacy, "a filter's old bits are read by plain ids too").toBe(true);
    expect(JSON.stringify(saved)).not.toContain(plainId("203.0.113.5"));
    // a player counted before counts once: learning again adds no use, reporting again adds no report
    lib.use(key, many[7]!);
    lib.report(key, "203.0.113.5");
    lib.use(key, "192.0.2.77");
    expect(lib.list()[0]!.uses, "only the newcomer counted").toBe(many.length + 1);
    expect(addressesIn(join(file, ".."))).toEqual([]);
  });
});

describe("the model budget keeps each caller's spend by code (P6a)", () => {
  const NOW = Date.UTC(2026, 10, 20, 9);

  it("writes no address, and holds an address and a /48 to their shares, across a restart", () => {
    const file = join(tmp("budget"), "model-budget.json");
    const b = createTokenBudget({ perDay: 100_000, perAddress: 100, file, now: () => NOW });
    b.spend(100, "203.0.113.5");
    for (const a of sixtyFours(4)) b.spend(100, a);
    expect(b.allowFor("203.0.113.5")).toBe(false);
    expect(b.allowFor("2001:db8:7:ff::/64"), "the /48 has spent four addresses' worth").toBe(false);
    expect(b.allowFor("198.51.100.1")).toBe(true);
    expect(addressesIn(join(file, ".."))).toEqual([]);
    const again = createTokenBudget({ perDay: 100_000, perAddress: 100, file, now: () => NOW });
    expect(again.allowFor("203.0.113.5")).toBe(false);
    expect(again.allowFor("2001:db8:7:ff::/64")).toBe(false);
  });

  it("codes a day's spend kept before, and it still counts", () => {
    const dir = tmp("budget-old");
    const file = join(dir, "model-budget.json");
    const day = new Date(NOW).toISOString().slice(0, 10);
    const old = {
      day,
      used: 500,
      calls: 2,
      by: { "203.0.113.5": 100, "2001:db8:7:1::/64": 50, "2001:db8:7::/48": 400, "(others)": 3 },
    };
    writeFileSync(file, JSON.stringify(old));
    writeFileSync(`${file}.bak`, JSON.stringify(old));
    const b = createTokenBudget({ perDay: 100_000, perAddress: 100, file, now: () => NOW });
    expect(addressesIn(dir), "no address survives the first open").toEqual([]);
    expect(b.allowFor("203.0.113.5")).toBe(false);
    expect(b.allowFor("2001:db8:7:ff::/64")).toBe(false);
    expect(b.allowFor("198.51.100.1")).toBe(true);
    expect(b.used()).toBe(500);
    expect((JSON.parse(readFileSync(file, "utf8")) as { by: Record<string, number> }).by).toEqual({
      [addressCode("203.0.113.5")]: 100,
      [addressCode("2001:db8:7:1::/64")]: 50,
      [prefixCode("2001:db8:7::/48")]: 400,
      "(others)": 3,
    });
  });
});

describe("sponsored pets keep a code of the asking network (P6a)", () => {
  const NOW = 1_800_000_000_000;
  const asked = async () => {
    const { request, signature } = await signSponsorRequest(privateKeyToAccount(generatePrivateKey()), {
      line: "gentle",
      state: ((0n << 152n) | 0x1234n).toString(),
      at: NOW,
    });
    return { ...request, signature };
  };
  const sponsor = async (g: SponsorGate, network: string) => {
    const r = await g.check(await asked(), network);
    if (r.ok) g.finish(r.slot, { petId: "1", hatchTx: "0x1", grantTx: "0x2", spentWei: 1n });
    return r.ok ? "ok" : r.reason;
  };

  it("writes no address, and holds a network to one a day and a /48 to three, across a restart", async () => {
    const file = join(tmp("sponsor"), "sponsored.json");
    const g = new SponsorGate({ file, enabled: true, now: () => NOW });
    expect(await sponsor(g, "203.0.113.5")).toBe("ok");
    expect(await sponsor(g, "203.0.113.5")).toBe("network");
    const net: string[] = [];
    for (const a of sixtyFours(5)) net.push(await sponsor(g, a));
    expect(net).toEqual(["ok", "ok", "ok", "network", "network"]);
    expect(addressesIn(join(file, ".."))).toEqual([]);
    const again = new SponsorGate({ file, enabled: true, now: () => NOW });
    expect(await sponsor(again, "203.0.113.5")).toBe("network");
    expect(await sponsor(again, "2001:db8:7:ff::/64")).toBe("network");
  });

  it("codes the networks of pets kept before, and they still count", async () => {
    const dir = tmp("sponsor-old");
    const file = join(dir, "sponsored.json");
    const old = {
      pets: [
        {
          to: "0x" + "1".repeat(40),
          petId: "1",
          network: "203.0.113.5",
          at: NOW,
          hatchTx: "0x1",
          grantTx: "0x2",
          spentWei: "1",
        },
      ],
    };
    writeFileSync(file, JSON.stringify(old));
    writeFileSync(`${file}.bak`, JSON.stringify(old));
    const g = new SponsorGate({ file, enabled: true, now: () => NOW });
    expect(addressesIn(dir), "no address survives the first open").toEqual([]);
    expect(g.pets()[0]!.network).toBe(addressCode("203.0.113.5"));
    expect(await sponsor(g, "203.0.113.5")).toBe("network");
  });
});

describe("reminder plans keep a code of the planning address (P6a)", () => {
  const NOON = Date.UTC(2026, 10, 16, 12);
  const sub = (endpoint: string) => ({
    endpoint,
    keys: {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  });
  const plan = (i: number): Plan => ({
    subscription: sub(`https://fcm.googleapis.com/fcm/send/d${i}`),
    lang: "en",
    name: "Mochi",
    tz: 0,
    reminders: [{ kind: "hungry", at: NOON + 3_600_000 }],
  });
  const pusher = (store: string) =>
    createPusher({
      publicKey: "pk",
      privateKey: "sk",
      subject: "https://lingxi.test",
      store,
      send: async () => ({ gone: false }),
    });

  it("writes no address, holds an address and a /48 to their devices, and codes plans kept before", () => {
    const dir = tmp("push");
    const store = join(dir, "push.json");
    const p = pusher(store);
    for (let i = 0; i < MAX_DEVICES_PER_ADDRESS; i++) expect(p.plan(plan(i), NOON, "203.0.113.5").ok).toBe(true);
    expect(p.plan(plan(99), NOON, "203.0.113.5")).toEqual({ ok: false, reason: "tooMany" });
    let network = 0;
    for (const [i, a] of sixtyFours(40).entries()) if (p.plan(plan(1_000 + i), NOON, a).ok) network++;
    expect(network).toBe(MAX_DEVICES_PER_ADDRESS * 4);
    expect(addressesIn(dir)).toEqual([]);
    // the file as a plan from before P6a wrote it
    const old = (JSON.parse(readFileSync(store, "utf8")) as Array<{ by?: string; net?: string }>).map((e) => {
      if (!e.net) return { ...e, by: "203.0.113.5" };
      const { net: _net, ...rest } = e;
      return { ...rest, by: "2001:db8:7:1::/64" };
    });
    writeFileSync(store, JSON.stringify(old));
    writeFileSync(`${store}.bak`, JSON.stringify(old));
    const again = pusher(store);
    expect(addressesIn(dir), "no address survives the first open").toEqual([]);
    expect(again.plan(plan(5_000), NOON, "203.0.113.5")).toEqual({ ok: false, reason: "tooMany" });
    expect(again.plan(plan(5_001), NOON, "2001:db8:7:ff::/64")).toEqual({ ok: false, reason: "tooMany" });
    expect(again.plan(plan(5_002), NOON, "198.51.100.1").ok).toBe(true);
  });
});

describe("duel links name their maker by keyed codes (P6a)", () => {
  const plainTag = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
  const id = (n: number) => `link${String(n).padStart(12, "0")}`;

  it("names a new link's file by codes, and renames one named before by plain hashes to the same codes", () => {
    const dir = tmp("duels");
    const s = createDuelStore(dir);
    s.put(id(1), "lxc1.one", 1_000, "2001:db8:7:1::/64");
    const [made] = readdirSync(dir);
    const [, by, net] = /^\w{16}\.([0-9a-f]{16})\.([0-9a-f]{16})\.txt$/.exec(made!)!;
    // a link named as before P6a: the maker and network as 12-character plain hashes
    writeFileSync(
      join(dir, `${id(2)}.${plainTag("2001:db8:7:1::/64")}.${plainTag("2001:db8:7::/48")}.txt`),
      "lxc1.two",
    );
    writeFileSync(join(dir, `${id(3)}.${plainTag("203.0.113.5")}.-.txt`), "lxc1.three");
    createDuelStore(dir);
    const names = readdirSync(dir).sort();
    expect(names).toContain(`${id(2)}.${by}.${net}.txt`);
    expect(names.some((n) => n.startsWith(`${id(3)}.`) && /^\w{16}\.[0-9a-f]{16}\.-\.txt$/.test(n))).toBe(true);
    expect(names.every((n) => !n.includes(plainTag("203.0.113.5")) && !n.includes(plainTag("2001:db8:7::/48")))).toBe(
      true,
    );
    expect(createDuelStore(dir).get(id(2))).toBe("lxc1.two");
  });
});
