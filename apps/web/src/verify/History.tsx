/**
 * A pet's life on chain, day by day (B5, Z1): when it hatched, every daily save with
 * the meters it recorded, every new brain, and its family. Listed by Lingxi's indexer
 * from PetRegistry's events; each row links to its transaction, so anyone can check
 * it on the explorer. The on-chain copy asks the live site's indexer for the same list.
 */

import { useEffect, useState } from "react";
import { unpackState } from "@lingxi/game";
import { type PetHistoryRecord, fetchPetHistory } from "./indexer";
import { lineageNow } from "./lineage";

const TX = (tx: string) => `https://www.oklink.com/xlayer/tx/${tx}`;

type History = PetHistoryRecord;

const T = {
  en: { title: "Its life on chain", none: "Nothing indexed for this pet yet.", hatched: "Hatched", saved: "Day {d} saved", brain: "New mind: circuit #{id}", parents: "Parents", children: "Little ones", lineageKept: "Recorded at birth, when the Breeder checked that its circuit was these two parents' child. Its brain today is still that circuit.", lineageChanged: "Recorded at birth, when the Breeder checked that its circuit was these two parents' child. Its brain has changed since (see \"New mind\" below), so the circuit this page checks is the one it has now, which may no longer be theirs.", source: "Listed by Lingxi's indexer from PetRegistry's events. Each row links to its transaction on X Layer; the meters are what the owner saved that day.", meters: "food {f} · joy {j} · energy {e} · clean {c}" },
  zh: { title: "它在链上的一生", none: "这只宠物还没有被索引到的记录。", hatched: "孵化", saved: "第 {d} 天已保存", brain: "新心智：电路 #{id}", parents: "父母", children: "小宝宝", lineageKept: "出生时记录：繁育合约当时核对过它的电路确实是这两位父母的孩子。它现在的大脑仍是那块电路。", lineageChanged: "出生时记录：繁育合约当时核对过它的电路确实是这两位父母的孩子。之后它的大脑换过（见下面的“新心智”），所以本页核对的是它现在的电路，可能已经不再是父母的。", source: "由灵犀的索引服务从 PetRegistry 的事件整理。每一行都链接到 X Layer 上的交易；数值是主人那天保存的状态。", meters: "饱腹 {f} · 开心 {j} · 精神 {e} · 干净 {c}" },
} as const;

const when = (sec: number | undefined, lang: "en" | "zh") => (sec ? new Date(sec * 1000).toLocaleString(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export function PetHistory({ id, brainBits, brainNow, lang, onOpen }: { id: string; brainBits: number; brainNow: string; lang: "en" | "zh"; onOpen: (id: string) => void }) {
  const t = T[lang];
  // a pet's history, with the pet it was read for: another pet's never shows while this one's is read
  const [read, setRead] = useState<{ id: string; h: History | "none" } | null>(null);
  const h = read?.id === id ? read.h : null;
  useEffect(() => {
    let live = true;
    fetchPetHistory(id)
      .then((j) => live && setRead({ id, h: j ?? "none" }))
      .catch(() => live && setRead({ id, h: "none" }));
    return () => {
      live = false;
    };
  }, [id]);
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
      {/* a child's parents are where it came from; whether its brain is still theirs is read from the chain (A24) */}
      {lineageNow(h, brainNow) && <p className="v-note v-lineage">{lineageNow(h, brainNow) === "kept" ? t.lineageKept : t.lineageChanged}</p>}
      <p className="v-note">{t.source}</p>
      <ol className="v-timeline">
        {rows.map((r) => (
          <li key={`${r.tx}-${r.label}`}>
            <span className="v-when">{when(h.at?.[r.block], lang)}</span>
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
