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
import { type Row, fullCheck, spotCheck } from "./checks";
import { type LogFile, type Stretch, parseLog, replayLogOnChain } from "./logReplay";
import { useDiaryCheck } from "./diaryCheck";
import { LogPanel, PetFacts } from "./PetFacts";
import { usePetRead } from "./petRead";
import { DiaryPanel, FullCheckPanel, SpotRows } from "./PetChecks";
import { T, WHY, short } from "./verifyText";
import { useRef, useState } from "react";
import { type Hex } from "viem";
import { bitsToWord } from "@lingxi/brain";
import { PetHistory } from "./History";
import { anchorBrains, loadCircuitFromChain, replayMany, replayStep } from "@lingxi/chain";
import { unpackState } from "@lingxi/game";

import { deployment } from "../game/chain";
import { proofClient } from "../game/proofRpc";
import { EndpointPanel } from "./Endpoints";
import { fetchPetHistory } from "./indexer";
import { otherStarter } from "./starterNote";
import { useLang } from "../i18n";
import { SiteFoot } from "../SiteFoot";
import { usePageMeta } from "../i18n/pageMeta";
import "./verify.css";
import { markProofChecked } from "../game/proofMark";

const note = (hosts: Set<string>) => (h: string, fallback: boolean) => hosts.add(fallback ? `${h} (fallback)` : h);

export function VerifyApp() {
  // the page's language, title and description, in the reader's language (A111)
  usePageMeta("verify");
  const { lang, toggle } = useLang();
  const t = T[lang];
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [runHosts, setRunHosts] = useState<ReadonlySet<string>>(new Set());
  const [allHosts, setAllHosts] = useState<ReadonlySet<string>>(new Set());
  const [logHosts, setLogHosts] = useState<ReadonlySet<string>>(new Set());
  // only a full pass (hash, anchors, replay) is shown as a pass
  const [logPassed, setLogPassed] = useState(false);
  const [logResult, setLogResult] = useState<string | null>(null);
  // the log runs from the pet's birth in the browser: neither a pass nor a failure (A66)
  const [logBirth, setLogBirth] = useState(false);
  const [logName, setLogName] = useState<string | null>(null);
  // the exhaustive check: every one of the 65,536 inputs at the pet's saved memory
  const [all, setAll] = useState<{
    done: number;
    bad: number;
    first?: string;
    secs?: number;
    stopped?: boolean;
  } | null>(null);
  const stopAll = useRef(false);
  // the pet in the address, read from X Layer with everything about it: its circuit, name colour and picture
  const { id, setId, pet, circuit, gates, circuitError, err, colour, meta, read } = usePetRead(t, () => {
    setRows([]);
    setLogResult(null);
  });
  const tooBigText = (n: number, max: number) =>
    t.tooBig
      .replace("{n}", n.toLocaleString(lang === "zh" ? "zh-CN" : "en"))
      .replace("{max}", max.toLocaleString(lang === "zh" ? "zh-CN" : "en"));
  // 32 inputs asked of X Layer and replayed here, shown as they arrive
  const run = async () => {
    if (!pet || !circuit || !deployment) return;
    const d = deployment;
    setRunning(true);
    const hosts = new Set<string>();
    const client = proofClient(0, note(hosts));
    const bits = pet.brainBits;
    const out = await spotCheck(
      { circuit, bits, saved: unpackState(pet.state, bits).brain },
      (state, word) => replayStep(client, d, pet.id, state, word),
      setRows,
    );
    if (out.every((r) => r.chain.next === r.local.next && r.chain.outputs === r.local.outputs)) markProofChecked();
    setRunHosts(hosts);
    setRunning(false);
  };

  // every one of the 65,536 inputs at the pet's saved memory
  const runAll = async () => {
    if (!pet || !circuit || !deployment) return;
    const d = deployment;
    stopAll.current = false;
    const t0 = performance.now();
    const saved = unpackState(pet.state, pet.brainBits).brain;
    const state = bitsToWord(saved);
    setAll({ done: 0, bad: 0 });
    const hosts = new Set<string>();
    // four workers, each starting at a different public endpoint and paced per host, so none rate-limits the page
    const clients = [0, 1, 2, 3].map((i) => proofClient(i, note(hosts)));
    const clientOf = (w: number) => {
      const c = clients[w];
      if (!c) throw new Error(`no proof worker ${w}`);
      return c;
    };
    const res = await fullCheck({ circuit, saved }, (w, words) => replayMany(clientOf(w), d, pet.id, state, words), {
      stop: () => stopAll.current,
      onProgress: setAll,
    });
    setAllHosts(hosts);
    setAll({ ...res, secs: Math.round((performance.now() - t0) / 1000), stopped: stopAll.current });
  };

  const onLog = async (file: File) => {
    // a file that is not a log is said to be one, never a hash that does not match (A57)
    const j = parseLog(await file.text());
    if (!j) {
      setLogPassed(false);
      setLogResult(t.logNotLog);
      return;
    }
    await replayLog(j);
  };

  /**
   * Replays a log against the brains read from the chain (logReplay.ts) and says how it ended. Returns the stretches
   * when all of it holds, "birth" when it runs from the pet's birth in the browser (A66), and null otherwise.
   */
  const replayLog = async (j: LogFile): Promise<Stretch[] | null | "birth"> => {
    if (!pet || !circuit || !deployment) return null;
    const d = deployment;
    const hosts = new Set<string>();
    const client = proofClient(0, note(hosts));
    const out = await replayLogOnChain(pet, j, {
      history: () => fetchPetHistory(pet.id.toString()),
      anchor: (brains, hints) => anchorBrains(client, d.registry, pet.id, brains, hints, pet.brainId),
      circuitOf: (brainId) => loadCircuitFromChain(client, pet.processor, brainId),
    });
    setLogHosts(hosts);
    if (out.kind === "ok") {
      const beats = lang === "zh" ? String(out.beats) : `${out.beats} ${out.beats === 1 ? "beat" : "beats"}`;
      const where =
        lang === "zh"
          ? `孵化交易 ${short(out.hatchTx)}，之后 ${out.changes} 次换大脑`
          : `hatched in ${short(out.hatchTx)}, then ${out.changes} new ${out.changes === 1 ? "brain" : "brains"}`;
      setLogPassed(true);
      setLogBirth(false);
      setLogResult(t.logOk.replace("{n}", beats).replace("{a}", where));
      return out.stretches;
    }
    setLogPassed(false);
    if (out.kind === "birth") {
      const beats = lang === "zh" ? String(out.beats) : `${out.beats} ${out.beats === 1 ? "beat" : "beats"}`;
      setLogBirth(true);
      setLogResult(t.logFromBirth.replace("{n}", beats));
      return "birth";
    }
    setLogBirth(false);
    setLogResult(
      out.kind === "badHash"
        ? t.logBadHash
        : out.kind === "noHints"
          ? t.notAnchored.replace("{why}", WHY[lang].noHints)
          : out.kind === "notAnchored"
            ? // the technical detail is in English, so the Chinese page gives the reason alone
              t.notAnchored.replace(
                "{why}",
                lang === "zh" ? WHY.zh[out.reason] : `${WHY.en[out.reason]} (${out.detail})`,
              )
            : out.kind === "badState"
              ? t.logBadState
              : out.kind === "tooBig"
                ? tooBigText(out.gates, out.max)
                : out.kind === "notLog"
                  ? t.logNotLog
                  : t.logUnread,
    );
    return null;
  };

  // Z1: the diary its owner published, checked here against the chain before a word of it is shown
  const { diaryNow, retryDiary } = useDiaryCheck(pet, circuit, replayLog);
  const diaryState = diaryNow?.state ?? "none";
  // a brain that is another line's starter, said so (A136)
  const starterOf = pet
    ? otherStarter(
        pet.line,
        pet.brainId,
        (deployment as { circuits?: Record<string, { id: string }> } | undefined)?.circuits,
      )
    : null;
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
        <input
          id="pet-id"
          inputMode="numeric"
          value={id}
          onChange={(e) => setId(e.target.value.replace(/\D/g, "").slice(0, 10))}
        />
        <button type="submit">{t.load}</button>
      </form>
      {err && <p className="v-err">{err}</p>}
      {!err && circuitError && (
        <p className="v-err">
          {"tooBig" in circuitError ? tooBigText(circuitError.tooBig.gates, circuitError.tooBig.max) : t.circuitUnread}
        </p>
      )}
      {/* P3: while the pet is read, its card's place is held, so the sections below do not jump when it arrives */}
      {!pet && !err && deployment && (
        <section className="v-card v-card-wait" aria-busy="true" aria-label={t.brain}>
          <p className="v-note">{t.reading}</p>
        </section>
      )}
      {pet && u && (
        <section className="v-card" aria-label={t.brain}>
          <PetFacts
            lang={lang}
            pet={pet}
            state={u}
            meta={meta}
            colour={colour}
            gates={gates}
            unsaved={unsaved}
            starterOf={starterOf}
            proven={logPassed || diaryState === "ok"}
          />
          <button type="button" className="v-run" onClick={run} disabled={running || !circuit}>
            {running ? t.running : t.run}
          </button>
          <FullCheckPanel
            lang={lang}
            all={all}
            hosts={allHosts}
            disabled={!circuit || running}
            onRun={runAll}
            onStop={() => (stopAll.current = true)}
          />
          <SpotRows lang={lang} rows={rows} running={running} hosts={runHosts} brainBits={pet.brainBits} />
          <DiaryPanel lang={lang} check={diaryNow} pet={pet} onRetry={retryDiary} />
          <PetHistory
            id={pet.id.toString()}
            brainBits={pet.brainBits}
            brainNow={pet.brainId.toString()}
            lang={lang}
            onOpen={(other) => {
              location.hash = other;
            }}
          />
          <LogPanel
            lang={lang}
            name={logName}
            result={logResult}
            passed={logPassed}
            birth={logBirth}
            hosts={logHosts}
            onFile={(f) => {
              setLogName(f?.name ?? null);
              if (f) void onLog(f);
            }}
          />
        </section>
      )}
      <EndpointPanel lang={lang} />
      <ProofTable lang={lang} />
      <RuleTable lang={lang} />
      <ContractTable lang={lang} />
      <p className="v-note">
        <a href="numbers.html" className="tap">
          {lang === "zh"
            ? "链上数字：宠物、交易和销毁的 BEM，全部读自合约"
            : "Live numbers: pets, sales and BEM burned, all read from the contracts"}
        </a>
      </p>
      <div className="v-note-wrap">
        <OnChainNote lang={lang} />
      </div>
      <SiteFoot lang={lang} />
    </main>
  );
}

export type { Hex };
