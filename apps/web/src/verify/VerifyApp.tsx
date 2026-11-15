/**
 * The proof page. Anyone can check a Lingxi pet without trusting us:
 *   1. read the pet straight from PetRegistry on X Layer;
 *   2. download its brain's netlist from the TapeOut processor and run it in our
 *      open TAP-02 evaluator, side by side with the processor's own `step`;
 *   3. drop in a pet's input log to recompute the keccak hash chain the last
 *      checkpoint committed to, and replay every beat to the memory on chain.
 */

import { useCallback, useEffect, useState } from "react";
import { type Hex } from "viem";
import { beat, bitsToWord, hexToBytes, load, type Circuit, wordToBits, decodeSenses } from "@lingxi/brain";
import { type ChainPet, readNetlist, readPet, replayStep } from "@lingxi/chain";
import { chainAll, unpackState, ZERO_HASH } from "@lingxi/game";
import { deployment, publicClient } from "../game/chain";
import { useLang } from "../i18n";
import "./verify.css";

interface Row {
  state: bigint;
  word: number;
  chain: { next: bigint; outputs: number };
  local: { next: bigint; outputs: number };
}

const T = {
  en: {
    title: "Verify a Lingxi pet",
    lede: "Every Lingxi pet's mind is a TapeOut circuit on X Layer. This page reads the chain directly and checks the pet's thoughts with an open evaluator, so you never have to trust the game.",
    id: "Pet number",
    load: "Read from X Layer",
    owner: "Owner",
    brain: "Brain circuit",
    gates: "gates",
    memory: "memory bits",
    days: "Days saved",
    log: "Committed input log",
    meters: "Saved state",
    run: "Check 32 thoughts",
    running: "Asking the processor...",
    match: "match",
    differ: "differ",
    allOk: "All {n} thoughts match: the processor on X Layer and the open evaluator give identical memory and outputs.",
    someBad: "{n} thoughts differ. Report this; it should never happen.",
    logTitle: "Check a day's log",
    logHelp: "Drop the log file the game exports (Pet → Download log). We recompute its hash chain and replay every beat.",
    logOk: "The log's hash equals the one on chain, and replaying its {n} gives exactly the saved memory.",
    logBadHash: "This log does not hash to the value on chain.",
    logBadState: "The hash matches, but the replay ends at a different memory than the one saved.",
    notFound: "No pet with that number.",
    notDeployed: "This build is not connected to a deployment.",
    want: "want",
    inputs: "inputs",
    state: "memory",
  },
  zh: {
    title: "验证一只灵犀宠物",
    lede: "每只灵犀宠物的心智都是 X Layer 上的 TapeOut 电路。本页直接读取链上数据，用开源求值器核对它的念头，你不需要相信游戏本身。",
    id: "宠物编号",
    load: "从 X Layer 读取",
    owner: "主人",
    brain: "大脑电路",
    gates: "个门",
    memory: "位记忆",
    days: "已保存天数",
    log: "已承诺的输入日志",
    meters: "保存的状态",
    run: "核对 32 个念头",
    running: "正在询问处理器……",
    match: "一致",
    differ: "不一致",
    allOk: "{n} 个念头全部一致：X Layer 上的处理器和开源求值器给出完全相同的记忆和输出。",
    someBad: "有 {n} 个念头不一致。请报告，这不应该发生。",
    logTitle: "核对某一天的日志",
    logHelp: "拖入游戏导出的日志文件（宠物 → 下载日志）。我们会重算哈希链并重放每一拍。",
    logOk: "日志哈希与链上一致，重放 {n} 拍后得到的记忆与保存的完全相同。",
    logBadHash: "这份日志的哈希和链上的不一致。",
    logBadState: "哈希一致，但重放后的记忆与保存的不同。",
    notFound: "没有这个编号的宠物。",
    notDeployed: "这个版本没有连接到部署。",
    want: "想要",
    inputs: "输入",
    state: "记忆",
  },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function VerifyApp() {
  const { lang, toggle } = useLang();
  const t = T[lang];
  const [id, setId] = useState(() => location.hash.replace("#", "") || "1");
  const [pet, setPet] = useState<ChainPet | null>(null);
  const [circuit, setCircuit] = useState<Circuit | null>(null);
  const [gates, setGates] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [logResult, setLogResult] = useState<string | null>(null);

  const read = useCallback(async () => {
    setErr(null);
    setRows([]);
    setLogResult(null);
    if (!deployment) return setErr(t.notDeployed);
    try {
      const p = await readPet(publicClient, deployment, BigInt(id));
      setPet(p);
      const nl = await readNetlist(publicClient, p.processor, p.brainId);
      setCircuit(load(hexToBytes(nl.bytes), nl.nIn, nl.nOut));
      setGates(nl.gates);
      history.replaceState(null, "", `#${id}`);
    } catch {
      setPet(null);
      setErr(t.notFound);
    }
  }, [id, t]);

  useEffect(() => {
    void read();
    // read once on open; later reads are explicit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (!pet || !circuit || !deployment) return;
    setRunning(true);
    const out: Row[] = [];
    const bits = pet.brainBits;
    const saved = unpackState(pet.state, bits).brain;
    for (let i = 0; i < 32; i++) {
      const state = i === 0 ? bitsToWord(saved) : BigInt(Math.floor(Math.random() * 2 ** Math.min(bits, 30)));
      const word = Math.floor(Math.random() * 65536);
      const chain = await replayStep(publicClient, deployment, pet.id, state, word);
      const [ns, outs] = beat(circuit, wordToBits(state, bits), wordToBits(word, 16));
      out.push({ state, word, chain, local: { next: bitsToWord(ns), outputs: Number(bitsToWord(outs)) } });
      setRows([...out]);
    }
    setRunning(false);
  };

  const onLog = async (file: File) => {
    if (!pet || !circuit) return;
    try {
      const j = JSON.parse(await file.text()) as { words: number[]; segments?: Array<{ brainId: string | null; words: number[] }> };
      const clean = (ws: number[]) => ws.filter((w) => Number.isInteger(w) && w >= 0 && w < 65536);
      const segments = j.segments?.length ? j.segments.map((sg) => ({ brainId: sg.brainId, words: clean(sg.words) })) : [{ brainId: pet.brainId.toString(), words: clean(j.words) }];
      const words = segments.flatMap((sg) => sg.words);
      if (chainAll(ZERO_HASH, words).toLowerCase() !== pet.logHash.toLowerCase()) return setLogResult(t.logBadHash);
      // each stretch of the log runs on the brain it was recorded with, read from the processor
      let st = new Array<number>(pet.brainBits).fill(0);
      for (const sg of segments) {
        if (!sg.words.length) continue;
        const id = BigInt(sg.brainId ?? pet.brainId.toString());
        const nl = await readNetlist(publicClient, pet.processor, id);
        const c = load(hexToBytes(nl.bytes), nl.nIn, nl.nOut);
        if (st.length !== c.nState) st = st.slice(0, c.nState).concat(new Array(Math.max(0, c.nState - st.length)).fill(0));
        for (const w of sg.words) st = beat(c, st, wordToBits(w, 16))[0];
      }
      const saved = unpackState(pet.state, pet.brainBits).brain;
      const beats = lang === "zh" ? String(words.length) : `${words.length} ${words.length === 1 ? "beat" : "beats"}`;
      setLogResult(st.join("") === saved.join("") ? t.logOk.replace("{n}", beats) : t.logBadState);
    } catch {
      setLogResult(t.logBadHash);
    }
  };

  const ok = rows.filter((r) => r.chain.next === r.local.next && r.chain.outputs === r.local.outputs).length;
  const u = pet ? unpackState(pet.state, pet.brainBits) : null;
  return (
    <main className="verify">
      <header className="v-head">
        <a href="play.html" className="v-brand">
          Lingxi · 灵犀
        </a>
        <button type="button" className="v-lang" onClick={toggle}>
          {lang === "en" ? "中文" : "EN"}
        </button>
      </header>
      <h1>{t.title}</h1>
      <p className="v-lede">{t.lede}</p>
      <form
        className="v-form"
        onSubmit={(e) => {
          e.preventDefault();
          void read();
        }}
      >
        <label htmlFor="pet-id">{t.id}</label>
        <input id="pet-id" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, "").slice(0, 10))} />
        <button type="submit">{t.load}</button>
      </form>
      {err && <p className="v-err">{err}</p>}
      {pet && u && (
        <section className="v-card" aria-label={t.brain}>
          <dl>
            <dt>{t.owner}</dt>
            <dd className="mono">{short(pet.owner)}</dd>
            <dt>{t.brain}</dt>
            <dd className="mono">
              {short(pet.processor)} · #{pet.brainId.toString()} · {gates} {t.gates} · {pet.brainBits} {t.memory}
            </dd>
            <dt>{t.days}</dt>
            <dd>{pet.day}</dd>
            <dt>{t.log}</dt>
            <dd className="mono">{short(pet.logHash)}</dd>
            <dt>{t.meters}</dt>
            <dd>
              food {u.meters.food} · joy {u.meters.joy} · energy {u.meters.energy} · clean {u.meters.clean} · xp {u.xp}
            </dd>
          </dl>
          <button type="button" className="v-run" onClick={run} disabled={running || !circuit}>
            {running ? t.running : t.run}
          </button>
          {rows.length > 0 && (
            <>
              <p className={ok === rows.length ? "v-ok" : "v-bad"}>{ok === rows.length ? t.allOk.replace("{n}", String(rows.length)) : t.someBad.replace("{n}", String(rows.length - ok))}</p>
              <div className="v-table" role="region" aria-label="beats" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t.state}</th>
                      <th>{t.inputs}</th>
                      <th>X Layer</th>
                      <th>{lang === "zh" ? "开源求值器" : "open evaluator"}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const same = r.chain.next === r.local.next && r.chain.outputs === r.local.outputs;
                      const s = decodeSenses(r.word);
                      return (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td className="mono">{r.state.toString(2).padStart(pet.brainBits, "0")}</td>
                          <td className="mono" title={JSON.stringify(s)}>
                            0x{r.word.toString(16).padStart(4, "0")}
                          </td>
                          <td className="mono">
                            {r.chain.next.toString(2).padStart(pet.brainBits, "0")} / {r.chain.outputs}
                          </td>
                          <td className="mono">
                            {r.local.next.toString(2).padStart(pet.brainBits, "0")} / {r.local.outputs}
                          </td>
                          <td className={same ? "v-ok" : "v-bad"}>{same ? t.match : t.differ}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="v-log">
            <p className="v-sub">{t.logTitle}</p>
            <p className="v-lede">{t.logHelp}</p>
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && onLog(e.target.files[0])} />
            {logResult && <p className={logResult === t.logBadHash || logResult === t.logBadState ? "v-bad" : "v-ok"}>{logResult}</p>}
          </div>
        </section>
      )}
    </main>
  );
}

export type { Hex };
