/**
 * The proof table (PRD U8): every circuit Lingxi relies on, with the hash of its
 * netlist as published, re-read from X Layer in this browser and marked when it
 * matches. The same table is in the README.
 */

import { useEffect, useState } from "react";
import { keccak256, type Hex } from "viem";
import { processorAbi } from "@lingxi/chain";
import { deployment } from "../game/chain";
import { proofClient } from "../game/proofRpc";

const CIRCUITS: ReadonlyArray<{ id: number; name: { en: string; zh: string }; gates: number; memory: number; hash: Hex }> = [
  { id: 1, name: { en: "Gentle starter brain", zh: "温柔系初始大脑" }, gates: 296, memory: 8, hash: "0xab2d7b0e5c8eeb1fcdf6f0225b6dd912459a26b6fcc73f86d5470152a18a1e47" },
  { id: 2, name: { en: "Bold starter brain", zh: "勇敢系初始大脑" }, gates: 233, memory: 8, hash: "0x085d9b6352bf1cd5f06061c948f48787db58469454558f627a198569d55b24cd" },
  { id: 3, name: { en: "Curious starter brain", zh: "好奇系初始大脑" }, gates: 248, memory: 8, hash: "0x372b08dab3d43d9d14e0f4c8884c8063d978264abbc1fe4261c8d25eb8064a7a" },
  { id: 4, name: { en: "Evolution (adult form)", zh: "进化（成年形态）" }, gates: 58, memory: 0, hash: "0x9dfb688b75b94a700690c28f34e978a0ef8bc2f2d5be621317f4d1f8fd8fc7d0" },
  { id: 5, name: { en: "Red-packet seal", zh: "红包封印" }, gates: 251, memory: 0, hash: "0x0d031b05b1928278eab4b2b82ecf15354990dc45311eedeaa1ea915a93687cb1" },
];

type Status = "checking" | "match" | "differs" | "unreachable";

export function ProofTable({ lang }: { lang: "en" | "zh" }) {
  const [status, setStatus] = useState<Record<number, Status>>({});
  useEffect(() => {
    if (!deployment) return;
    let live = true;
    void Promise.all(
      CIRCUITS.map(async (c, i) => {
        setStatus((s) => ({ ...s, [c.id]: "checking" }));
        try {
          const client = proofClient(i);
          const nl = (await client.readContract({ address: deployment!.processor, abi: processorAbi, functionName: "netlist", args: [BigInt(c.id)] })) as Hex;
          if (live) setStatus((s) => ({ ...s, [c.id]: keccak256(nl) === c.hash ? "match" : "differs" }));
        } catch {
          if (live) setStatus((s) => ({ ...s, [c.id]: "unreachable" }));
        }
      }),
    );
    return () => {
      live = false;
    };
  }, []);
  const word: Record<Status, { en: string; zh: string }> = {
    checking: { en: "checking…", zh: "核对中……" },
    match: { en: "✓ matches X Layer", zh: "✓ 与 X Layer 一致" },
    differs: { en: "✗ differs", zh: "✗ 不一致" },
    unreachable: { en: "X Layer unreachable", zh: "连不上 X Layer" },
  };
  return (
    <section className="v-card v-proof-table v-circuits" aria-labelledby="proof-table-h">
      <h2 id="proof-table-h">{lang === "zh" ? "证明表" : "Proof table"}</h2>
      <p className="v-note">
        {lang === "zh"
          ? `处理器 ${deployment?.processor ?? ""}（TapeOut 第 419 号）。每个电路的网表哈希都在你的浏览器里从链上重新读取核对。`
          : `Processor ${deployment?.processor ?? ""} (TapeOut #419). Each circuit's netlist hash is read again from the chain in your browser.`}
      </p>
      <div className="v-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{lang === "zh" ? "电路" : "Circuit"}</th>
              <th>Id</th>
              <th>{lang === "zh" ? "门" : "Gates"}</th>
              <th>{lang === "zh" ? "记忆位" : "Memory"}</th>
              <th>keccak256</th>
              <th>{lang === "zh" ? "核对" : "Check"}</th>
            </tr>
          </thead>
          <tbody>
            {CIRCUITS.map((c) => (
              <tr key={c.id}>
                {/* on a phone each row is a block: name and check first, then the labelled figures, then the hash (A68) */}
                <td className="v-c-name">{c.name[lang]}</td>
                <td className="v-c-fig" data-label="Id">{c.id}</td>
                <td className="v-c-fig" data-label={lang === "zh" ? "门" : "Gates"}>{c.gates}</td>
                <td className="v-c-fig" data-label={lang === "zh" ? "记忆位" : "Memory bits"}>{c.memory}</td>
                <td className="mono v-c-hash" data-label="keccak256" title={c.hash}>
                  {c.hash.slice(0, 10)}…{c.hash.slice(-6)}
                </td>
                <td className={`v-c-check ${status[c.id] === "match" ? "v-ok" : status[c.id] === "differs" ? "v-bad" : ""}`}>{word[status[c.id] ?? "checking"][lang]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
