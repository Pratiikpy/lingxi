/**
 * What the server reads from X Layer for a page (P7: out of server.ts): a pet's history, red packets'
 * claims, the family tree, and published diaries.
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { createReadStream } from "node:fs";
import { Hono } from "hono";
import { PublishedLog } from "@lingxi/api-schema";
import { RateLimiter } from "../limit";
import { type Indexer } from "../indexer";
import { type PacketIndex } from "../packets";
import { buildTree } from "../tree";
import { type DiaryStore, type PetOnChain } from "../diaries";
import { type LogHasher, createLogHasher } from "../logHash";
import { clientIp } from "../clientIp";

/** A pet's history from the chain's events: hatching, daily saves, brain changes, family. */
export function withHistory(app: Hono, indexer: Indexer): Hono {
  app.get("/api/pets/:id/history", (c) => {
    const id = c.req.param("id");
    if (!/^\d{1,12}$/.test(id)) return c.json({ ok: false, reason: "invalid" }, 400);
    c.header("Cache-Control", "public, max-age=20");
    const h = indexer.history(id);
    return h
      ? c.json({ ok: true, indexedTo: indexer.head(), ...h })
      : c.json({ ok: false, reason: "unknown", indexedTo: indexer.head() });
  });
  return app;
}

/** Who opened a red packet (A1): read from the claims index, never from a log query a public node would refuse. */
export function withPackets(app: Hono, index: Pick<PacketIndex, "claimsOf" | "head">): Hono {
  app.get("/api/packets/:id/claims", (c) => {
    const id = c.req.param("id");
    if (!/^\d{1,20}$/.test(id)) return c.json({ ok: false, reason: "invalid" }, 400);
    c.header("Cache-Control", "public, max-age=10");
    const p = index.claimsOf(id);
    return p
      ? c.json({ ok: true, indexedTo: index.head(), ...p })
      : c.json({ ok: false, reason: "unknown", indexedTo: index.head() });
  });
  return app;
}

/** The most pets one page of the tree holds (A147). */
export const TREE_PAGE_MAX = 1_000;

/**
 * The tree of life: every pet on chain with its generation, ancestors and the
 * owners who raised them. Names come from PetLook and name colours from the
 * extras contract (plan 4.9); both are remembered for ten minutes.
 */
export function withTree(
  app: Hono,
  indexer: Pick<Indexer, "pets" | "head">,
  nameOf?: (id: string) => Promise<string>,
  coloursOf?: (ids: string[]) => Promise<Record<string, number>>,
): Hono {
  const names = new Map<string, { name: string; at: number }>();
  const colours = new Map<string, { colour: number; at: number }>();
  const NAME_TTL = 10 * 60_000;
  // one refresh at a time, whoever asks: requests arriving during it wait for the same one (A52)
  let refreshing: Promise<void> | null = null;
  const refresh = async (pets: ReturnType<typeof indexer.pets>) => {
    if (nameOf) {
      const stale = pets.filter((p) => (names.get(p.id)?.at ?? 0) < Date.now() - NAME_TTL).slice(0, 50);
      // eight reads at a time
      for (let i = 0; i < stale.length; i += 8)
        await Promise.all(
          stale
            .slice(i, i + 8)
            .map(async (p) =>
              names.set(p.id, { name: await nameOf(p.id).catch(() => names.get(p.id)?.name ?? ""), at: Date.now() }),
            ),
        );
    }
    if (coloursOf) {
      const stale = pets
        .filter((p) => (colours.get(p.id)?.at ?? 0) < Date.now() - NAME_TTL)
        .slice(0, 200)
        .map((p) => p.id);
      if (stale.length) {
        const got = await coloursOf(stale).catch(() => null);
        if (got) for (const id of stale) colours.set(id, { colour: got[id] ?? 0, at: Date.now() });
      }
    }
  };
  // the built tree, kept until the indexer moves on or a name or colour changes (A147)
  let built: { key: string; tree: ReturnType<typeof buildTree>; text: string } | null = null;
  const look = (pets: ReturnType<typeof indexer.pets>) =>
    pets.map((p) => `${names.get(p.id)?.name ?? ""}:${colours.get(p.id)?.colour ?? 0}`).join("|");
  app.get("/api/tree", async (c) => {
    const pets = indexer.pets();
    refreshing ??= refresh(pets).finally(() => (refreshing = null));
    await refreshing;
    const key = `${indexer.head()}:${pets.length}:${look(pets)}`;
    if (built?.key !== key) {
      const tree = buildTree(
        pets.map((p) => {
          const name = names.get(p.id)?.name;
          const colour = colours.get(p.id)?.colour;
          return { ...p, ...(name ? { name } : {}), ...(colour ? { colour } : {}) };
        }),
      );
      built = { key, tree, text: JSON.stringify({ ok: true, indexedTo: indexer.head(), ...tree }) };
    }
    c.header("Cache-Control", "public, max-age=30");
    // a page of pets after a given one, for whoever wants the tree in parts (A147); the whole tree otherwise
    const after = c.req.query("after");
    const limit = Number(c.req.query("limit") ?? "");
    if (after !== undefined || c.req.query("limit") !== undefined) {
      const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, TREE_PAGE_MAX) : TREE_PAGE_MAX;
      const from = after === undefined ? 0 : built.tree.pets.findIndex((p) => p.id === after) + 1;
      const page = built.tree.pets.slice(Math.max(0, from), Math.max(0, from) + n);
      const more = Math.max(0, from) + n < built.tree.pets.length;
      const { pets: _all, ...counts } = built.tree;
      return c.json({
        ok: true,
        indexedTo: indexer.head(),
        ...counts,
        pets: page,
        ...(more && page.length ? { next: page[page.length - 1]!.id } : {}),
      });
    }
    c.header("content-type", "application/json; charset=utf-8");
    return c.body(built.text);
  });
  return app;
}

/**
 * Public diaries: owners publish the log their pet's checkpoint committed to; it is kept only if it
 * hashes to the log hash on chain, and anyone may read it (read-only, any origin).
 */
export function withDiaries(
  app: Hono,
  store: DiaryStore,
  chainOf: (id: string) => Promise<PetOnChain | null>,
  hash: LogHasher = createLogHasher(),
): Hono {
  const limiter = new RateLimiter(20, 60 * 60_000);
  app.get("/api/pets/:id/log", (c) => {
    const id = c.req.param("id");
    if (!/^\d{1,12}$/.test(id)) return c.json({ ok: false, reason: "invalid" }, 400);
    const at = store.where(id);
    c.header("Cache-Control", "public, max-age=30");
    if (!at) return c.json({ ok: false, reason: "none" });
    c.header("content-type", "application/json; charset=utf-8");
    const head = '{"ok":true,"log":';
    if ("text" in at) return c.body(`${head}${at.text}}`);
    // streamed from its file a piece at a time, as fast as the reader takes it: no diary is ever held whole (A39)
    const pieces = createReadStream(at.file)[Symbol.asyncIterator]();
    const bytes = new TextEncoder();
    let stage: "head" | "file" | "tail" = "head";
    return c.body(
      new ReadableStream<Uint8Array>({
        async pull(out) {
          if (stage === "head") {
            out.enqueue(bytes.encode(head));
            stage = "file";
            return;
          }
          if (stage === "file") {
            const next = await pieces.next();
            if (!next.done) return out.enqueue(next.value as Uint8Array);
            stage = "tail";
          }
          out.enqueue(bytes.encode("}"));
          out.close();
        },
        async cancel() {
          await pieces.return?.();
        },
      }),
    );
  });
  app.post("/api/pets/:id/log", async (c) => {
    const ip = clientIp(c);
    // a refusal a player can meet is an answer, not an error a browser would log (A39); only a malformed request is a 400
    if (!limiter.take(ip)) return c.json({ ok: false, reason: "busy" });
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    // parsed once here; the store checks every cheap bound before the hash, which runs in a worker (A114)
    const published = PublishedLog.safeParse(body);
    if (!published.success || published.data.petId !== id) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = await store.publishLog(published.data, await chainOf(id).catch(() => null), ip, hash);
    return c.json(r, !r.ok && r.reason === "invalid" ? 400 : 200);
  });
  return app;
}
