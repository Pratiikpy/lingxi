/**
 * The proof page. Anyone can check a Lingxi pet without trusting us:
 *   1. read the pet straight from PetRegistry on X Layer, through the public RPCs (or the judge's own), never
 *      through our server unless every public endpoint fails, and then said so (see game/proofRpc.ts);
 *   2. download its brain's netlist from the TapeOut processor and run it in our
 *      open TAP-02 evaluator, side by side with the processor's own `step`;
 *   3. drop in a pet's input log to recompute the keccak hash chain the last checkpoint committed to, anchor every
 *      brain the log names to the pet's own events on chain, and replay every beat to the memory on chain.
 */

import { OnChainNote } from "../OnChainNote";
import { ProofTable } from "./ProofTable";
import { RuleTable } from "./RuleTable";
import { ContractTable } from "./ContractTable";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { type Hex } from "viem";
import { beat, bitsToWord, circuitBrain, type Circuit, wordToBits, decodeSenses } from "@lingxi/brain";
import { PetHistory } from "./History";
import { BrainTooBigError, type ChainPet, anchorBrains, canvasOfSvg, gameSprite, lineOfState, loadCircuitFromChain, lookOf, nameColours, readMetadata, readPet, replayMany, replayStep } from "@lingxi/chain";
import { Named } from "../play/Named";
import { type DiaryLine, chainAll, diaryOfStretches, diaryText, unpackState, ZERO_HASH } from "@lingxi/game";

import { deployment } from "../game/chain";
import { proofClient } from "../game/proofRpc";
import { EndpointPanel } from "./Endpoints";
import { INDEXER, fetchPetHistory } from "./indexer";
import { useLang } from "../i18n";
import "./verify.css";
import { markProofChecked } from "../game/proofMark";

interface Row {
  state: bigint;
  word: number;
  chain: { next: bigint; outputs: number };
  local: { next: bigint; outputs: number };
}

const T = {
  en: {
    title: "Verify a Lingxi pet",
    lede: "Every Lingxi pet's mind is a TapeOut circuit on X Layer. This page reads the chain from your browser through X Layer's public RPCs (or your own) and checks the pet's thoughts with an open evaluator, so you never have to trust the game.",
    id: "Pet number",
    load: "Read from X Layer",
    owner: "Owner",
    brain: "Brain circuit",
    gates: "gates",
    memory: "memory bits",
    days: "Days saved",
    log: "Committed input log",
    meters: "Saved state",
    proven: "Memory, proven by replay",
    reported: "Reported by the owner",
    reportedNote: "The owner's game writes the rest of the state word when it saves a day; the chain keeps it but cannot check it. Only the memory bits are proven, by the log check below.",
    run: "Check 32 thoughts",
    running: "Asking the processor...",
    match: "match",
    differ: "differ",
    allOk: "All {n} thoughts match: the processor on X Layer and the open evaluator give identical memory and outputs.",
    someBad: "{n} thoughts differ. Report this; it should never happen.",
    logTitle: "Check a day's log",
    logPick: "Choose a log file",
    logNone: "No file chosen",
    logHelp: "Drop the log file the game exports (Pet → Download log). We recompute its hash chain and replay every beat.",
    logOk: "The log's hash equals the one on chain, every brain it names is anchored to this pet's own events on X Layer ({a}), and replaying its {n} gives exactly the saved memory.",
    notAnchored: "The log's hash matches, but its brains could not be anchored to this pet's events on X Layer: {why}",
    logBadHash: "This log does not hash to the value on chain.",
    logBadState: "The hash matches, but the replay ends at a different memory than the one saved.",
    notFound: "No pet with that number.",
    tooBig: "This pet's brain on X Layer would run {n} gates each beat, more than any pet's mind can ({max}), so this page will not run it.",
    circuitUnread: "Its circuit couldn't be read from X Layer just now. Try again in a moment.",
    picture: "Its picture, drawn on chain",
    pictureNote: "PetLook draws this from the pet's saved state: its stage, its mood and whether its circuit glows. This page only shows what the chain returns.",
    pictureSame: "Pixel for pixel the game's own art for this state.",
    pictureDiff: "This picture differs from the game's art for this state.",
    unsaved: "Born on X Layer from #{a} and #{b}, and its first day is not saved yet: the chain holds only the memory the Breeder mixed for it, so until its owner saves a day PetLook draws an egg and every meter reads 0. Those zeros are not its state.",
    lineMismatch: "PetRegistry records this pet as the {recorded} line, but its saved state is a {state} pet's, and that is what it is drawn and thinks as. It was hatched that way; the game can no longer write such a pet, and the checks below are unaffected.",
    lines: ["gentle", "bold", "curious"],
    named: "Name on chain",
    notDeployed: "This build is not connected to a deployment.",
    want: "want",
    inputs: "inputs",
    state: "memory",
  },
  zh: {
    title: "验证一只灵犀宠物",
    lede: "每只灵犀宠物的心智都是 X Layer 上的 TapeOut 电路。本页由你的浏览器通过 X Layer 的公共 RPC（或你自己的）读取链上数据，用开源求值器核对它的念头，你不需要相信游戏本身。",
    id: "宠物编号",
    load: "从 X Layer 读取",
    owner: "主人",
    brain: "大脑电路",
    gates: "个门",
    memory: "位记忆",
    days: "已保存天数",
    log: "已承诺的输入日志",
    meters: "保存的状态",
    proven: "记忆，由重放证明",
    reported: "由主人上报",
    reportedNote: "其余的状态由主人的游戏在保存当天时写入；链上保存它，但无法核对它。只有记忆位能被证明，方法是下面的日志核对。",
    run: "核对 32 个念头",
    running: "正在询问处理器……",
    match: "一致",
    differ: "不一致",
    allOk: "{n} 个念头全部一致：X Layer 上的处理器和开源求值器给出完全相同的记忆和输出。",
    someBad: "有 {n} 个念头不一致。请报告，这不应该发生。",
    logTitle: "核对某一天的日志",
    logPick: "选择日志文件",
    logNone: "还没有选择文件",
    logHelp: "拖入游戏导出的日志文件（宠物 → 下载日志）。我们会重算哈希链并重放每一拍。",
    logOk: "日志哈希与链上一致，它用到的每个大脑都锚定在这只宠物在 X Layer 上的事件（{a}），重放 {n} 拍后得到的记忆与保存的完全相同。",
    notAnchored: "日志哈希一致，但它用到的大脑无法锚定到这只宠物在 X Layer 上的事件：{why}",
    logBadHash: "这份日志的哈希和链上的不一致。",
    logBadState: "哈希一致，但重放后的记忆与保存的不同。",
    notFound: "没有这个编号的宠物。",
    tooBig: "这只宠物在 X Layer 上的大脑每一拍要跑 {n} 个门，超过任何宠物心智的上限（{max} 个），所以本页不会运行它。",
    circuitUnread: "暂时没能从 X Layer 读到它的电路，请稍后再试。",
    picture: "它的样子，由链上绘制",
    pictureNote: "PetLook 根据宠物保存的状态画出这张图：成长阶段、心情，以及电路有没有亮。本页只是显示链上返回的结果。",
    pictureSame: "与游戏里这个状态的画面逐像素一致。",
    pictureDiff: "这张图和游戏里这个状态的画面不一致。",
    unsaved: "由 #{a} 和 #{b} 在 X Layer 上生下，它的第一天还没保存：链上只有繁育合约为它混合好的记忆，所以在主人保存一天之前，PetLook 会把它画成一颗蛋，各项数值都显示 0。这些 0 并不是它的状态。",
    lineMismatch: "PetRegistry 把这只宠物记为{recorded}品种，但它保存的状态是{state}品种的，它的样子和想法都按这个来。它出生时就是这样；游戏现在已经不会再写出这样的宠物，下面的核对不受影响。",
    lines: ["温柔", "勇敢", "好奇"],
    named: "链上名字",
    notDeployed: "这个版本没有连接到部署。",
    want: "想要",
    inputs: "输入",
    state: "记忆",
  },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** why a log's brains could not be anchored, in plain words */
const WHY = {
  en: { noHints: "no hatching transaction was found to read", noHatch: "the transaction named is not this pet's hatching", hatchBrain: "the log starts with a brain the pet did not hatch with", unanchored: "a brain it names has no matching event for this pet", skipsChange: "it leaves out a brain the pet held", notCurrent: "it does not end with the pet's brain on record" },
  zh: { noHints: "找不到它孵化的交易", noHatch: "给出的交易不是这只宠物的孵化", hatchBrain: "日志开头的大脑不是它孵化时的大脑", unanchored: "日志用到的某个大脑在链上没有这只宠物对应的事件", skipsChange: "日志漏掉了它用过的一个大脑", notCurrent: "日志结尾的大脑不是它现在记录在链上的大脑" },
} as const;
/** the page's reads of the pet; the checks below each take their own client, to say who answered them */
const pc = proofClient();
const viaText = (hosts: ReadonlySet<string>, lang: "en" | "zh") => (hosts.size ? `${lang === "zh" ? "回答者：" : "Answered by "}${[...hosts].join(", ")}` : "");
const note = (hosts: Set<string>) => (h: string, fallback: boolean) => hosts.add(fallback ? `${h} (fallback)` : h);

export function VerifyApp() {
  const { lang, toggle } = useLang();
  const t = T[lang];
  const [id, setId] = useState(() => location.hash.replace("#", "") || "1");
  const [pet, setPet] = useState<ChainPet | null>(null);
  const [circuit, setCircuit] = useState<Circuit | null>(null);
  const [gates, setGates] = useState(0);
  // why the pet's circuit is not shown: too big to run (A38), or not read just now
  const [circuitError, setCircuitError] = useState<{ tooBig: { gates: number; max: number } } | { unread: true } | null>(null);
  // with no deployment to read from, the page says so from the start
  const [err, setErr] = useState<string | null>(() => (deployment ? null : t.notDeployed));
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [runHosts, setRunHosts] = useState<ReadonlySet<string>>(new Set());
  const [allHosts, setAllHosts] = useState<ReadonlySet<string>>(new Set());
  const [logHosts, setLogHosts] = useState<ReadonlySet<string>>(new Set());
  // only a full pass (hash, anchors, replay) is shown as a pass
  const [logPassed, setLogPassed] = useState(false);
  const [logResult, setLogResult] = useState<string | null>(null);
  const [logName, setLogName] = useState<string | null>(null);
  const [colour, setColour] = useState(0);
  // the exhaustive check: every one of the 65,536 inputs at the pet's saved memory
  const [all, setAll] = useState<{ done: number; bad: number; first?: string; secs?: number; stopped?: boolean } | null>(null);
  const stopAll = useRef(false);
  // the picture and name the registry serves for this pet, drawn by PetLook
  const [meta, setMeta] = useState<{ name: string; image?: string; same?: boolean } | null>(null);

  // a pet read from X Layer is shown with everything about it read alongside: its name colour, its picture, its circuit
  const show = useCallback(
    async (forId: string, p: ChainPet) => {
      setPet(p);
      setMeta(null);
      setColour(0);
      // its name colour (plan 4.9), from the extras contract
      if (deployment!.extras)
        void nameColours(pc, deployment!, [BigInt(forId)])
          .then((c) => setColour(c[forId] ?? 0))
          .catch(() => setColour(0));
      void readMetadata(pc, deployment!, BigInt(forId))
        .then((m) => {
          const svg = m.image?.startsWith("data:image/svg+xml;base64,") ? atob(m.image.slice(26)) : null;
          setMeta({ name: m.name, image: m.image, same: svg ? JSON.stringify(canvasOfSvg(svg).px) === JSON.stringify(gameSprite(lookOf(p.state)).px) : undefined });
        })
        .catch(() => setMeta(null));
      // a child's circuit REFs its parents' circuits; those are read from the chain too. A brain no pet's mind could be
      // is not run (A38): the pet is still shown, its circuit is not
      setCircuitError(null);
      try {
        const c = await loadCircuitFromChain(pc, p.processor, p.brainId);
        setCircuit(c);
        setGates(c.nGates);
      } catch (e) {
        setCircuit(null);
        setCircuitError(e instanceof BrainTooBigError ? { tooBig: { gates: e.gates, max: e.max } } : { unread: true });
      }
      history.replaceState(null, "", `#${forId}`);
    },
    [],
  );
  const tooBigText = (n: number, max: number) => t.tooBig.replace("{n}", n.toLocaleString(lang === "zh" ? "zh-CN" : "en")).replace("{max}", max.toLocaleString(lang === "zh" ? "zh-CN" : "en"));
  const notFound = useCallback(() => {
    setPet(null);
    setErr(t.notFound);
  }, [t]);
  const fetchPet = (forId: string) => readPet(pc, deployment!, BigInt(forId));
  // a read asked for (the form, a family link followed) starts from a clean page
  const read = (forId = id) => {
    setErr(null);
    setRows([]);
    setLogResult(null);
    if (!deployment) return setErr(t.notDeployed);
    return fetchPet(forId).then((p) => show(forId, p).catch(notFound), notFound);
  };

  // read once on open, for the pet in the address (the page starts clean); later reads are the reader's own
  const readOnOpen = useEffectEvent(() => fetchPet(id).then((p) => show(id, p).catch(notFound), notFound));
  useEffect(() => {
    if (deployment) void readOnOpen();
  }, []);

  // following a family link (or editing the address) opens that pet
  const openFromHash = useEffectEvent((h: string) => {
    setId(h);
    void read(h);
  });
  useEffect(() => {
    const on = () => {
      const h = location.hash.replace("#", "");
      if (/^\d{1,10}$/.test(h)) openFromHash(h);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const run = async () => {
    if (!pet || !circuit || !deployment) return;
    setRunning(true);
    const hosts = new Set<string>();
    const client = proofClient(0, note(hosts));
    const out: Row[] = [];
    const bits = pet.brainBits;
    const saved = unpackState(pet.state, bits).brain;
    for (let i = 0; i < 32; i++) {
      const state = i === 0 ? bitsToWord(saved) : BigInt(Math.floor(Math.random() * 2 ** Math.min(bits, 30)));
      const word = Math.floor(Math.random() * 65536);
      const chain = await replayStep(client, deployment, pet.id, state, word);
      const [ns, outs] = beat(circuit, wordToBits(state, bits), wordToBits(word, 16));
      out.push({ state, word, chain, local: { next: bitsToWord(ns), outputs: Number(bitsToWord(outs)) } });
      setRows([...out]);
    }
    if (out.every((r) => r.chain.next === r.local.next && r.chain.outputs === r.local.outputs)) markProofChecked();
    setRunHosts(hosts);
    setRunning(false);
  };

  const runAll = async () => {
    if (!pet || !circuit || !deployment) return;
    stopAll.current = false;
    const t0 = performance.now();
    const bits = pet.brainBits;
    const saved = unpackState(pet.state, bits).brain;
    const state = bitsToWord(saved);
    const BATCH = 64;
    let next = 0;
    let done = 0;
    let bad = 0;
    let first: string | undefined;
    setAll({ done: 0, bad: 0 });
    const hosts = new Set<string>();
    // four workers, each starting at a different public endpoint and paced per host, so none rate-limits the page
    const worker = async (client: ReturnType<typeof proofClient>) => {
      while (next < 65536 && !stopAll.current) {
        const from = next;
        next += BATCH;
        const words = Array.from({ length: Math.min(BATCH, 65536 - from) }, (_, k) => from + k);
        let chain: Array<{ next: bigint; outputs: number }> = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            chain = await replayMany(client, deployment!, pet.id, state, words);
            await new Promise((r) => setTimeout(r, 120));
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
        words.forEach((w, k) => {
          const [ns, outs] = beat(circuit, saved, wordToBits(w, 16));
          const c = chain[k];
          if (!c || c.next !== bitsToWord(ns) || c.outputs !== Number(bitsToWord(outs))) {
            bad++;
            first ??= `0x${w.toString(16).padStart(4, "0")}`;
          }
        });
        done += words.length;
        setAll({ done, bad, ...(first ? { first } : {}) });
      }
    };
    await Promise.all([0, 1, 2, 3].map((i) => worker(proofClient(i, note(hosts)))));
    setAllHosts(hosts);
    setAll({ done, bad, ...(first ? { first } : {}), secs: Math.round((performance.now() - t0) / 1000), stopped: stopAll.current });
  };

  const onLog = async (file: File) => {
    try {
      await replayLog(JSON.parse(await file.text()));
    } catch {
      setLogPassed(false);
      setLogResult(t.logBadHash);
    }
  };

  /**
   * Replays a log against the brains read from the chain. Before a beat is replayed, every brain the log names is
   * anchored to this pet's own Hatched and BrainChanged events on X Layer (the indexer only says which transactions
   * to read), and the starting memory is the one in its Hatched event. Returns the stretches when all of it holds.
   */
  const replayLog = async (j: { words: number[]; segments?: Array<{ brainId: string | null; words: number[] }> }): Promise<Array<{ brain: { fast: ReturnType<typeof circuitBrain>; nState: number }; words: number[] }> | null> => {
    if (!pet || !circuit || !deployment) return null;
    const hosts = new Set<string>();
    const client = proofClient(0, note(hosts));
    const fail = (text: string) => {
      setLogPassed(false);
      setLogResult(text);
      setLogHosts(hosts);
      return null;
    };
    try {
      const clean = (ws: number[]) => ws.filter((w) => Number.isInteger(w) && w >= 0 && w < 65536);
      const segments = (j.segments?.length ? j.segments.map((sg) => ({ brainId: sg.brainId, words: clean(sg.words) })) : [{ brainId: pet.brainId.toString(), words: clean(j.words) }]).filter((sg) => sg.words.length);
      const words = segments.flatMap((sg) => sg.words);
      if (chainAll(ZERO_HASH, words).toLowerCase() !== pet.logHash.toLowerCase()) return fail(t.logBadHash);

      const brains = segments.map((sg) => BigInt(sg.brainId ?? pet.brainId.toString()));
      const hints = await fetchPetHistory(pet.id.toString()).catch(() => null);
      if (!hints?.hatched) return fail(t.notAnchored.replace("{why}", WHY[lang].noHints));
      const anchored = await anchorBrains(client, deployment.registry, pet.id, brains.length ? brains : [pet.brainId], { hatched: hints.hatched.tx as Hex, changes: hints.brains.map((b) => b.tx as Hex) }, pet.brainId);
      // the technical detail is in English, so the Chinese page gives the reason alone
      if (!anchored.ok) return fail(t.notAnchored.replace("{why}", lang === "zh" ? WHY.zh[anchored.reason] : `${WHY.en[anchored.reason]} (${anchored.detail})`));

      const stretches: Array<{ brain: { fast: ReturnType<typeof circuitBrain>; nState: number }; words: number[] }> = [];
      // the starting memory is the one the pet hatched with, from its Hatched event
      let st: number[] | null = null;
      for (const sg of segments) {
        const c = await loadCircuitFromChain(client, pet.processor, BigInt(sg.brainId ?? pet.brainId.toString()));
        st = st === null ? unpackState(anchored.startState, c.nState).brain : st.length === c.nState ? st : st.slice(0, c.nState).concat(new Array(Math.max(0, c.nState - st.length)).fill(0));
        for (const w of sg.words) st = beat(c, st, wordToBits(w, 16))[0];
        stretches.push({ brain: { fast: circuitBrain(c), nState: c.nState }, words: sg.words });
      }
      const end = st ?? unpackState(anchored.startState, pet.brainBits).brain;
      const saved = unpackState(pet.state, pet.brainBits).brain;
      const beats = lang === "zh" ? String(words.length) : `${words.length} ${words.length === 1 ? "beat" : "beats"}`;
      const changes = anchored.anchors.length - 1;
      const where = lang === "zh" ? `孵化交易 ${short(anchored.anchors[0]!.tx)}，之后 ${changes} 次换大脑` : `hatched in ${short(anchored.anchors[0]!.tx)}, then ${changes} new ${changes === 1 ? "brain" : "brains"}`;
      if (end.join("") !== saved.join("")) return fail(t.logBadState);
      setLogPassed(true);
      setLogResult(t.logOk.replace("{n}", beats).replace("{a}", where));
      setLogHosts(hosts);
      return stretches;
    } catch (e) {
      // a brain past any pet's mind is said as such, never as a hash that does not match (A38)
      return fail(e instanceof BrainTooBigError ? tooBigText(e.gates, e.max) : t.logBadHash);
    }
  };

  // Z1: the diary its owner published, checked here against the chain before a word of it is shown
  // the published log is checked against the pet and circuit shown at that moment
  const replayPublished = useEffectEvent((log: Parameters<typeof replayLog>[0]) => replayLog(log));
  const petId = pet?.id;
  const logHash = pet?.logHash;
  // the diary's check, with the pet, log and circuit it was made for: it shows only while those are still on the page
  const [diaryCheck, setDiaryCheck] = useState<{ petId: unknown; logHash: unknown; circuit: Circuit; state: "checking" | "ok" | "bad"; diary?: DiaryLine[] } | null>(null);
  const diaryNow = diaryCheck && diaryCheck.petId === petId && diaryCheck.logHash === logHash && diaryCheck.circuit === circuit ? diaryCheck : null;
  const diary = diaryNow?.diary ?? null;
  const diaryState = diaryNow?.state ?? "none";
  useEffect(() => {
    if (petId === undefined || !circuit) return;
    let live = true;
    const said = (state: "checking" | "ok" | "bad", lines?: DiaryLine[]) => live && setDiaryCheck({ petId, logHash, circuit, state, ...(lines ? { diary: lines } : {}) });
    fetch(`${INDEXER}/api/pets/${petId}/log`, { signal: AbortSignal.timeout(8000) })
      .then((res) => res.json() as Promise<{ ok: boolean; log?: { words: number[]; segments: Array<{ brainId: string | null; words: number[] }> } }>)
      .then(async (r) => {
        if (!live || !r.ok || !r.log) return;
        said("checking");
        const stretches = await replayPublished(r.log);
        if (!stretches) return said("bad");
        said("ok", diaryOfStretches(stretches.map((x) => ({ brain: { fast: x.brain.fast, nState: x.brain.nState }, words: x.words }))));
      })
      .catch(() => {
        // no published diary: nothing to show
      });
    return () => {
      live = false;
    };
  }, [petId, logHash, circuit]);

  const ok = rows.filter((r) => r.chain.next === r.local.next && r.chain.outputs === r.local.outputs).length;
  const u = pet ? unpackState(pet.state, pet.brainBits) : null;
  // a little one hatched by the Breeder and never saved: its state is only the memory the Breeder mixed (A33)
  const unsaved = !!pet && pet.day === 0 && (pet.parentA !== 0n || pet.parentB !== 0n);
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
      {!err && circuitError && <p className="v-err">{"tooBig" in circuitError ? tooBigText(circuitError.tooBig.gates, circuitError.tooBig.max) : t.circuitUnread}</p>}
      {pet && u && (
        <section className="v-card" aria-label={t.brain}>
          {meta?.image && (
            <figure className="v-picture">
              <img src={meta.image} alt={meta.name} width={144} height={144} />
              <figcaption>
                <Named name={meta.name} colour={colour} />
                <span className="v-note">{t.pictureNote}</span>
                {meta.same !== undefined && <span className={meta.same ? "v-ok" : "v-bad"}>{meta.same ? t.pictureSame : t.pictureDiff}</span>}
                {/* a record whose line is not its state's (mainnet pet #2, A18) is said, not left for a reader to find */}
                {!unsaved && pet.line !== lineOfState(pet.state) && (
                  <span className="v-note v-line">
                    {t.lineMismatch.replace("{recorded}", t.lines[pet.line] ?? `#${pet.line}`).replace("{state}", t.lines[lineOfState(pet.state)] ?? `#${lineOfState(pet.state)}`)}
                  </span>
                )}
              </figcaption>
            </figure>
          )}
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
              <span className="v-tag v-tag-proven">{t.proven}</span> <span className="mono">{u.brain.join("")}</span>
              <br />
              {/* a little one never saved holds only its mixed memory: its zeros are said to be zeros, not shown as its state (A33) */}
              {unsaved ? (
                <span className="v-note v-block v-unsaved">{t.unsaved.replace("{a}", pet.parentA.toString()).replace("{b}", pet.parentB.toString())}</span>
              ) : (
                <>
                  <span className="v-tag v-tag-reported">{t.reported}</span>{" "}
                  {lang === "zh"
                    ? `饱腹 ${u.meters.food} · 开心 ${u.meters.joy} · 精神 ${u.meters.energy} · 干净 ${u.meters.clean} · 经验 ${u.xp}`
                    : `food ${u.meters.food} · joy ${u.meters.joy} · energy ${u.meters.energy} · clean ${u.meters.clean} · xp ${u.xp}`}
                  <span className="v-note v-block">{t.reportedNote}</span>
                </>
              )}
            </dd>
          </dl>
          <button type="button" className="v-run" onClick={run} disabled={running || !circuit}>
            {running ? t.running : t.run}
          </button>
          <div className="v-all">
            <p className="v-note">
              {lang === "zh"
                ? "或者问遍全部：在它保存的记忆下，把 65,536 种可能的感受全部交给 X Layer 上的处理器，再逐一和开源求值器比对（约 2–3 分钟）。"
                : "Or ask everything: at its saved memory, every one of the 65,536 possible inputs goes to the processor on X Layer and is compared with the open evaluator (about 2–3 minutes)."}
            </p>
            {all && !all.secs && !all.stopped ? (
              <>
                <div className="v-progress" role="progressbar" aria-valuemin={0} aria-valuemax={65536} aria-valuenow={all.done}>
                  <i style={{ transform: `scaleX(${all.done / 65536})` }} />
                </div>
                <p className="v-note">
                  {all.done.toLocaleString()} / 65,536 {all.bad ? (lang === "zh" ? `· ${all.bad} 处不一致` : `· ${all.bad} differ`) : ""}{" "}
                  <button type="button" className="v-link" onClick={() => (stopAll.current = true)}>
                    {lang === "zh" ? "停止" : "Stop"}
                  </button>
                </p>
              </>
            ) : (
              <button type="button" className="v-run" onClick={runAll} disabled={!circuit || running}>
                {lang === "zh" ? "问遍全部 65,536 种输入" : "Ask all 65,536 inputs"}
              </button>
            )}
            {all?.secs !== undefined && (
              <p className={all.bad === 0 && !all.stopped ? "v-ok" : "v-bad"}>
                {all.stopped
                  ? lang === "zh"
                    ? `已停止：核对了 ${all.done.toLocaleString()} 种，${all.bad} 处不一致。`
                    : `Stopped: ${all.done.toLocaleString()} checked, ${all.bad} differ.`
                  : all.bad === 0
                    ? lang === "zh"
                      ? `65,536 种输入全部一致（${all.secs} 秒）。在这份记忆下，它每一个可能的念头都和链上处理器相同。`
                      : `All 65,536 inputs match (${all.secs}s). At this memory, every thought it could possibly have is the processor's own.`
                    : lang === "zh"
                      ? `${all.bad} 种输入不一致，第一个是 ${all.first}。`
                      : `${all.bad} inputs differ, the first at ${all.first}.`}
              </p>
            )}
            {all?.secs !== undefined && allHosts.size > 0 && <p className="v-note mono" data-testid="all-hosts">{viaText(allHosts, lang)}</p>}
          </div>
          {rows.length > 0 && (
            <>
              <p className={ok === rows.length ? "v-ok" : "v-bad"}>{ok === rows.length ? t.allOk.replace("{n}", String(rows.length)) : t.someBad.replace("{n}", String(rows.length - ok))}</p>
              {!running && runHosts.size > 0 && <p className="v-note mono" data-testid="run-hosts">{viaText(runHosts, lang)}</p>}
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
          {diaryState !== "none" && (
            <div className="v-diary">
              <p className="v-sub">{lang === "zh" ? "它的日记" : "Its diary"}</p>
              {diaryState === "checking" && <p className="v-note">{lang === "zh" ? "正在对照链上核对它的日记……" : "Checking its diary against the chain…"}</p>}
              {diaryState === "bad" && <p className="v-bad">{lang === "zh" ? "发布的日记没能通过链上核对（原因见下面的日志核对），所以不显示。" : "The published diary did not pass the check against the chain (the log check below says why), so it isn't shown."}</p>}
              {diaryState === "ok" && diary && (
                <>
                  <p className="v-note">{lang === "zh" ? "最近一天，用锚定在链上事件的大脑逐刻重放得来，并与链上保存的记忆一致。" : "Its latest day, replayed moment by moment through brains anchored to its events on chain, ending at exactly the memory saved on chain."}</p>
                  <ul>
                    {diary.map((l, i) => (
                      <li key={i}>{diaryText(l, lang)}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <PetHistory
            id={pet.id.toString()}
            brainBits={pet.brainBits}
            brainNow={pet.brainId.toString()}
            lang={lang}
            onOpen={(other) => {
              location.hash = other;
            }}
          />
          <div className="v-log">
            <p className="v-sub">{t.logTitle}</p>
            <p className="v-lede">{t.logHelp}</p>
            <div className="v-file">
              <label className="v-run v-pick">
                {t.logPick}
                <input
                  type="file"
                  accept="application/json"
                  className="v-file-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setLogName(f?.name ?? null);
                    if (f) void onLog(f);
                  }}
                />
              </label>
              <span className="v-note mono">{logName ?? t.logNone}</span>
            </div>
            {logResult && <p className={logPassed ? "v-ok" : "v-bad"} data-testid="log-result">{logResult}</p>}
            {logResult && logHosts.size > 0 && <p className="v-note mono">{viaText(logHosts, lang)}</p>}
          </div>
        </section>
      )}
      <EndpointPanel lang={lang} />
      <ProofTable lang={lang} />
      <RuleTable lang={lang} />
      <ContractTable lang={lang} />
      <p className="v-note">
        <a href="numbers.html">{lang === "zh" ? "链上数字：宠物、交易和销毁的 BEM，全部读自合约" : "Live numbers: pets, sales and BEM burned, all read from the contracts"}</a>
      </p>
      <div className="v-note-wrap">
        <OnChainNote lang={lang} />
      </div>
    </main>
  );
}

export type { Hex };
