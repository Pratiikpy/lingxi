/**
 * A pet's life on chain, day by day (B5, Z1): when it hatched, every daily save with
 * the meters it recorded, every new brain, and its family. Listed by Lingxi's indexer
 * from PetRegistry's events; each row links to its transaction, so anyone can check
 * it on the explorer. The on-chain build has no indexer and says where to look.
 */

import { useEffect, useState } from "react";
import { unpackState } from "@lingxi/game";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
const TX = (tx: string) => `https://www.oklink.com/xlayer/tx/${tx}`;

interface History {
  hatched?: { block: number; tx: string; line: number; brainId: string; state: string };
  parents?: [string, string];
  children: string[];
  saves: Array<{ day: number; state: string; logHash: string; block: number; tx: string }>;
  brains: Array<{ brainId: string; bits: number; block: number; tx: string }>;
  at: Record<string, number>;
}

const T = {
  en: { title: "Its life on chain", none: "Nothing indexed for this pet yet.", hatched: "Hatched", saved: "Day {d} saved", brain: "New mind: circuit #{id}", parents: "Parents", children: "Little ones", offline: "The day-by-day history is listed by Lingxi's indexer, which this on-chain copy doesn't use. Open this page on lingxi.knole.me to see it, or read the PetRegistry events on the explorer.", meters: "food {f} · joy {j} · energy {e} · clean {c}" },
  zh: { title: "它在链上的一生", none: "这只宠物还没有被索引到的记录。", hatched: "孵化", saved: "第 {d} 天已保存", brain: "新心智：电路 #{id}", parents: "父母", children: "小宝宝", offline: "逐日记录由灵犀的索引服务整理，链上版本不使用它。请在 lingxi.knole.me 打开本页查看，或在区块浏览器里查看 PetRegistry 的事件。", meters: "饱腹 {f} · 开心 {j} · 精神 {e} · 干净 {c}" },
} as const;

const when = (sec: number | undefined, lang: "en" | "zh") => (sec ? new Date(sec * 1000).toLocaleString(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export function PetHistory({ id, brainBits, lang, onOpen }: { id: string; brainBits: number; lang: "en" | "zh"; onOpen: (id: string) => void }) {
  const t = T[lang];
  const [h, setH] = useState<History | null | "none">(null);
  useEffect(() => {
    if (!BASE) return;
    let live = true;
    setH(null);
    fetch(`${BASE}/api/pets/${id}/history`, { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json() as Promise<{ ok: boolean } & History>)
      .then((j) => live && setH(j.ok ? j : "none"))
      .catch(() => live && setH("none"));
    return () => {
      live = false;
    };
  }, [id]);
  if (!BASE) return <p className="v-note">{t.offline}</p>;
  if (h === null) return null;
  if (h === "none") return <p className="v-note">{t.none}</p>;
  const rows: Array<{ block: number; tx: string; label: string; detail?: string }> = [];
  if (h.hatched) rows.push({ block: h.hatched.block, tx: h.hatched.tx, label: t.hatched });
  for (const s of h.saves) {
    const u = unpackState(BigInt(s.state), brainBits);
    rows.push({ block: s.block, tx: s.tx, label: t.saved.replace("{d}", String(s.day)), detail: t.meters.replace("{f}", String(u.meters.food)).replace("{j}", String(u.meters.joy)).replace("{e}", String(u.meters.energy)).replace("{c}", String(u.meters.clean)) });
  }
  for (const b of h.brains) rows.push({ block: b.block, tx: b.tx, label: t.brain.replace("{id}", b.brainId) });
  rows.sort((a, b) => a.block - b.block);
  const link = (pid: string) => (
    <button key={pid} type="button" className="v-petlink" onClick={() => onOpen(pid)}>
      #{pid}
    </button>
  );
  return (
    <div className="v-history">
      <p className="v-sub">{t.title}</p>
      {(h.parents || h.children.length > 0) && (
        <p className="v-family">
          {h.parents && (
            <span>
              {t.parents}: {link(h.parents[0])} {link(h.parents[1])}
            </span>
          )}
          {h.children.length > 0 && (
            <span>
              {t.children}: {h.children.map(link)}
            </span>
          )}
        </p>
      )}
      <ol className="v-timeline">
        {rows.map((r) => (
          <li key={`${r.tx}-${r.label}`}>
            <span className="v-when">{when(h.at[r.block], lang)}</span>
            <b>{r.label}</b>
            {r.detail && <span className="v-note">{r.detail}</span>}
            <a className="mono" href={TX(r.tx)} target="_blank" rel="noopener noreferrer">
              {r.tx.slice(0, 10)}…
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
