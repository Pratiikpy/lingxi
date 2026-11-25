/**
 * Choosing whom to spar with (P7: out of Arena.tsx): the designed partners, the Fly brains, a brain read from X
 * Layer, an adopted pet, a partner's card, and the daily partner.
 */
/**
 * Friendly spars. Pick a partner, watch the fight round by round (every move is
 * the pet's own circuit answering the fight on its pins), then hear from the
 * coach, who tests every fight lesson the pet has room for and suggests the one
 * that actually wins more.
 */

import { useEffect, useMemo, useState } from "react";
import { FLY, drawFly, drawPet } from "@lingxi/art";
import { STARTERS, chipName, programOfChips } from "@lingxi/brain";
import {
  DESIGNED_PARTNERS,
  composeProgram,
  type Fighter,
  PARTNERS,
  type Partner,
  type Pet,
  FLY_RIVALS,
  type FlyRival,
  FlyLinkError,
  flyFighter,
  parseFlyBrain,
} from "@lingxi/game";

import { useDaily } from "../../game/daily";
import { Chips } from "../parts";
import { type Profile, fighterOf, flySource, readCircuit, useAdopted } from "../../game/adopt";
import type { OutsideCircuit } from "@lingxi/chain";
import { chipsFor } from "../ruleText";
import { useLang } from "../../i18n";
import { useSpar } from "../../game/spar";
import { play } from "../../game/sound";
import "../arena.css";
import "../rewind.css";
import { DEFAULT_PROCESSOR, LINE_ZH, type Lang, PetArt, READ_ERR, STAGE_INDEX, coloursOf, short } from "./shared";

/** F27: partners whose brains were evolved by search, one per stage, each shown with how it was made and a way to beat it. */
export function DesignedPartners({ onPick }: { onPick: (p: Partner) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [hint, setHint] = useState<string | null>(null);
  return (
    <section className="sp-designed" aria-label={L("Designed by search", "由搜索设计")}>
      <p className="label">{L("Designed by search", "由搜索设计")}</p>
      <p className="small">
        {L(
          "These brains were not written by hand. A search evolved each one against the partners above, the three starter brains and the earlier designs, inside the gate budget a pet of that stage has. One was kept only if a pet of that stage can be taught to beat it.",
          "这些大脑不是手写的。搜索让每一个在上面的陪练、三种初始大脑和之前设计出的对手之间不断进化，并且不超过同阶段宠物的门数预算。只有同阶段的宠物能学会打败它的，才会被留下。",
        )}
      </p>
      <ul className="sp-partners">
        {DESIGNED_PARTNERS.map((p) => {
          const d = p.design;
          const open = hint === p.id;
          return (
            <li key={p.id} className="sp-designed-item">
              <PartnerCard partner={p} index={STAGE_INDEX[p.stage] ?? 0} lang={lang} onPick={() => onPick(p)} inItem />
              <p className="small sp-designed-facts">
                {L(
                  `${d.gates} gates · ${d.generations} generations · won ${Math.round(d.test * 100)}% of its test fights`,
                  `${d.gates} 个门 · 进化 ${d.generations} 代 · 测试对局胜率 ${Math.round(d.test * 100)}%`,
                )}{" "}
                <button
                  type="button"
                  className="sp-hint-btn"
                  aria-expanded={open}
                  onClick={() => (play("tap"), setHint(open ? null : p.id))}
                >
                  {open ? L("Hide the way to beat it", "收起打败它的方法") : L("A way to beat it", "打败它的方法")}
                </button>
              </p>
              {open && (
                <div className="sp-hint">
                  <p className="small">
                    {L(
                      `A ${d.counter.line} pet taught ${d.counter.lessons.length === 1 ? "this lesson" : `these ${d.counter.lessons.length} lessons`} won ${Math.round(d.counter.wins * 100)}% of its fights against ${p.name.en}:`,
                      `学了${d.counter.lessons.length === 1 ? "这一课" : `这 ${d.counter.lessons.length} 课`}的${LINE_ZH[d.counter.line]}宠物，和${p.name.zh}对打赢了 ${Math.round(d.counter.wins * 100)}%：`,
                    )}
                  </p>
                  {d.counter.lessons.map((r, i) => {
                    const c = chipsFor(composeProgram(d.counter.line, d.counter.lessons), r, lang, true);
                    return (
                      <div key={i} className="sp-hint-lesson">
                        <span className="small">{L(`Lesson ${i + 1}`, `第 ${i + 1} 课`)}</span>
                        <Chips when={c.when} then={c.then} want={c.want} />
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A1b: brains written for TapeFly's brawl, run as the same NAND circuits TapeFly compiles. */
export function FlyBrains({ pet, onFight }: { pet: Pet; onFight: (partner: Partner, opponent: Fighter) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const art = useMemo(() => drawFly(), []);
  const asPartner = (id: string, name: string, blurb: { en: string; zh: string }): Partner => ({
    id: `fly:${id}`,
    name: { en: name, zh: name },
    look: "fly",
    line: "curious",
    stage: "baby",
    level: 1,
    blurb,
    program: STARTERS.curious,
  });
  const adopt = useAdopted((s) => s.adopt);
  const fightRival = (r: FlyRival) =>
    onFight(
      asPartner(r.id, r.name, {
        en: r.chips.map((c) => chipName(c, "en")).join(" → "),
        zh: r.chips.map((c) => chipName(c, "zh")).join(" → "),
      }),
      flyFighter(r.name, programOfChips(r.chips), 1),
    );
  const fightLink = () => {
    try {
      const program = parseFlyBrain(text);
      setErr("");
      onFight(
        asPartner("link", L("TapeFly brain", "TapeFly 大脑"), { en: "", zh: "" }),
        flyFighter(L("TapeFly brain", "TapeFly 大脑"), program, 1),
      );
    } catch (e) {
      play("error");
      setErr(
        e instanceof FlyLinkError
          ? L(
              "That isn't a TapeFly brain. Paste a brawl link with program= or chips=, a p1. code, or chips like block,bite.",
              "这不是 TapeFly 的大脑。请粘贴带 program= 或 chips= 的大乱斗链接、p1. 开头的代码，或像 block,bite 这样的芯片列表。",
            )
          : String(e),
      );
    }
  };
  return (
    <section className="sp-fly" aria-label={L("TapeFly brains", "TapeFly 大脑")}>
      <div className="sp-fly-head">
        <span className="sp-portrait">
          <PetArt canvas={art} line="curious" palette={FLY} scale={2} />
        </span>
        <div>
          <p className="label">{L("Brains from TapeFly · DUEL-12x3/1", "来自 TapeFly 的大脑 · DUEL-12x3/1")}</p>
          <p className="small">
            {L(
              "TapeFly's brawl is another game built on TapeOut. Its fly brains are 12-in, 3-out NAND circuits; here they are compiled exactly as TapeFly compiles them and fight your pet through the same interface.",
              "TapeFly 的大乱斗是另一款建在 TapeOut 上的游戏。它的果蝇大脑是 12 进 3 出的 NAND 电路；这里按 TapeFly 一模一样的方式编译，并通过同一个接口和你的宠物切磋。",
            )}
          </p>
        </div>
      </div>
      <ul className="sp-fly-ladder">
        {FLY_RIVALS.map((r) => (
          <li key={r.id}>
            <button type="button" className="sp-fly-rival" onClick={() => fightRival(r)}>
              <b>{r.name}</b>
              <span className="small">
                {r.chips.length === 1
                  ? chipName(r.chips[0]!, lang === "zh" ? "zh" : "en")
                  : `${r.chips.length} ${L("chips", "张芯片")}`}
              </span>
              <span className="small sp-fly-gates">
                {L(
                  `${flyFighter(r.name, programOfChips(r.chips)).gates} gates`,
                  `${flyFighter(r.name, programOfChips(r.chips)).gates} 个门`,
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="sp-fly-link"
        onSubmit={(e) => {
          e.preventDefault();
          fightLink();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={L("Paste a TapeFly brawl link or p1. code", "粘贴 TapeFly 大乱斗链接或 p1. 代码")}
          aria-label={L("TapeFly brain link", "TapeFly 大脑链接")}
        />
        <button type="submit" className="btn" disabled={!text.trim()}>
          {L("Spar it", "切磋")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!text.trim()}
          onClick={() => {
            try {
              const program = parseFlyBrain(text);
              setErr("");
              let from = L("a player on TapeFly", "TapeFly 上的一位玩家");
              try {
                if (/^https?:/i.test(text.trim())) from = new URL(text.trim()).host;
              } catch {
                // not a link: a p1. code or chips
              }
              adopt(pet.bornAt, {
                name: L("TapeFly brain", "TapeFly 大脑"),
                author: from,
                profile: "DUEL-12x3/1",
                gates: flyFighter("x", program).gates,
                source: flySource(program),
              });
              play("success");
            } catch {
              play("error");
              setErr(
                L(
                  "That isn't a TapeFly brain. Paste a brawl link with program= or chips=, a p1. code, or chips like block,bite.",
                  "这不是 TapeFly 的大脑。请粘贴带 program= 或 chips= 的大乱斗链接、p1. 开头的代码，或像 block,bite 这样的芯片列表。",
                ),
              );
            }
          }}
        >
          {L("Adopt it", "收养")}
        </button>
      </form>
      {err && (
        <p className="small sp-warn" role="alert">
          {err}
        </p>
      )}
      <ChainBrain pet={pet} onFight={onFight} />
      <AdoptedCard pet={pet} />
    </section>
  );
}

/** Z7: any circuit on X Layer by processor and number, as a sparring partner or an adopted instinct. */
export function ChainBrain({ pet, onFight }: { pet: Pet; onFight: (partner: Partner, opponent: Fighter) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const adopt = useAdopted((s) => s.adopt);
  const [processor, setProcessor] = useState(DEFAULT_PROCESSOR);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<{ circuit: OutsideCircuit; profile: Profile } | null>(null);
  const [err, setErr] = useState("");
  const name = (c: OutsideCircuit) => L(`Circuit #${c.id}`, `#${c.id} 号电路`);
  const asPartner = (c: OutsideCircuit): Partner => ({
    id: `chain:${c.processor}:${c.id}`,
    name: { en: `Circuit #${c.id}`, zh: `#${c.id} 号电路` },
    line: "curious",
    stage: "adult",
    level: 1,
    blurb: { en: "", zh: "" },
    program: STARTERS.curious,
  });
  const sourceOf = (c: OutsideCircuit) => ({
    kind: "chain" as const,
    processor: c.processor,
    id: c.id,
    parts: c.parts,
  });
  return (
    <div className="sp-chain">
      <p className="label">{L("A circuit on X Layer", "X Layer 上的电路")}</p>
      <p className="small">
        {L(
          "Any brain taped out on a TapeOut processor whose pins fit a fight: TapeFly's brawl format, or a pet's. Its maker is credited.",
          "任何在 TapeOut 处理器上流片、引脚接得上切磋的大脑：TapeFly 的大乱斗格式，或宠物的格式。会注明作者。",
        )}
      </p>
      <form
        className="sp-chain-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          setGot(null);
          const r = await readCircuit(processor.trim(), id.trim());
          setBusy(false);
          if (r.ok) setGot({ circuit: r.circuit, profile: r.profile });
          else {
            play("error");
            setErr(READ_ERR[r.reason]![lang]);
          }
        }}
      >
        <input
          value={processor}
          onChange={(e) => setProcessor(e.target.value)}
          placeholder="0x…"
          aria-label={L("Processor address", "处理器地址")}
          spellCheck={false}
        />
        <input
          value={id}
          onChange={(e) => setId(e.target.value.replace(/\D/g, ""))}
          placeholder={L("circuit #", "电路编号")}
          inputMode="numeric"
          aria-label={L("Circuit number", "电路编号")}
        />
        <button type="submit" className="btn" disabled={busy || !id || !processor}>
          {busy ? L("Reading…", "读取中……") : L("Read it", "读取")}
        </button>
      </form>
      {err && (
        <p className="small sp-warn" role="alert">
          {err}
        </p>
      )}
      {got && (
        <div className="sp-chain-got">
          <p className="small">
            <b>{name(got.circuit)}</b> ·{" "}
            {got.profile === "DUEL-12x3/1" ? L("TapeFly brawl pins", "TapeFly 大乱斗引脚") : L("pet pins", "宠物引脚")}{" "}
            · {L(`${got.circuit.gates} gates`, `${got.circuit.gates} 个门`)}
            {got.circuit.nState ? L(` · ${got.circuit.nState} memory bits`, ` · ${got.circuit.nState} 位记忆`) : ""}
            {got.circuit.parts.length > 1
              ? L(
                  ` · uses ${got.circuit.parts.length - 1} other circuits`,
                  ` · 引用了 ${got.circuit.parts.length - 1} 个别的电路`,
                )
              : ""}
            <br />
            {L("Made by ", "作者 ")}
            {got.circuit.owner ? short(got.circuit.owner) : L("unknown", "未知")}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                onFight(
                  asPartner(got.circuit),
                  fighterOf({ source: sourceOf(got.circuit), profile: got.profile }, name(got.circuit), 1),
                )
              }
            >
              {L("Spar against it", "和它切磋")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                adopt(pet.bornAt, {
                  name: name(got.circuit),
                  author: got.circuit.owner,
                  profile: got.profile,
                  gates: got.circuit.gates,
                  source: sourceOf(got.circuit),
                });
                play("success");
              }}
            >
              {L(`Adopt as ${pet.name}'s fighting instinct`, `收养为${pet.name}的战斗本能`)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The adopted instinct, with its credit, a switch, and a way to let it go. */
export function AdoptedCard({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const a = useAdopted((s) => s.byPet[String(pet.bornAt)]);
  const setOn = useAdopted((s) => s.setOn);
  const drop = useAdopted((s) => s.drop);
  if (!a) return null;
  const by = /^0x[0-9a-fA-F]{40}$/.test(a.author) ? short(a.author) : a.author;
  return (
    <div className="sp-adopted" role="status">
      <p className="small">
        <b>{L(`${pet.name}'s fighting instinct: ${a.name}`, `${pet.name}的战斗本能：${a.name}`)}</b>
        <br />
        {L(`Made by ${by}`, `作者 ${by}`)}
        {a.source.kind === "chain"
          ? L(
              ` · circuit #${a.source.id} on ${short(a.source.processor)}`,
              ` · ${short(a.source.processor)} 上的 #${a.source.id} 号电路`,
            )
          : ""}{" "}
        · {L(`${a.gates} gates`, `${a.gates} 个门`)}
      </p>
      <p className="small">
        {L(
          `While it is on, ${pet.name} fights practice spars with this brain. The daily challenge, seasons and duel links always use ${pet.name}'s own mind, so anyone can replay them.`,
          `打开时，${pet.name}在练习切磋里用这个大脑。每日挑战、赛季和链接切磋一直用${pet.name}自己的心智，这样谁都能重放。`,
        )}
      </p>
      <div className="row">
        <label className="sp-cheer">
          <input type="checkbox" checked={a.on} onChange={(e) => (play("tap"), setOn(pet.bornAt, e.target.checked))} />
          <span>{L("Use it in practice spars", "在练习切磋里使用")}</span>
        </label>
        <button type="button" className="btn" onClick={() => (play("tap"), drop(pet.bornAt))}>
          {L("Let it go", "放下它")}
        </button>
      </div>
    </div>
  );
}

/** A partner to pick; `inItem` when it sits inside a list item of its own (the designed partners), so no list item nests in another. */
export function PartnerCard({
  partner,
  index,
  lang,
  onPick,
  inItem = false,
}: {
  partner: Partner;
  index: number;
  lang: Lang;
  onPick: () => void;
  inItem?: boolean;
}) {
  const record = useSpar((s) => s.records[partner.id]);
  const canvas = useMemo(
    () =>
      drawPet(partner.line, partner.stage, { expression: index === 0 ? "sleepy" : index === 3 ? "proud" : "happy" }),
    [partner.line, partner.stage, index],
  );
  const stars = index + 1;
  const Wrap = inItem ? "div" : "li";
  return (
    <Wrap>
      <button type="button" className="sp-partner" onClick={onPick}>
        <span className="sp-portrait">
          <PetArt
            canvas={canvas}
            line={partner.line}
            palette={coloursOf(partner)}
            scale={2}
            label={partner.name[lang]}
          />
        </span>
        <span className="sp-who">
          <b>{partner.name[lang]}</b>
          <span className="sp-stars" aria-label={lang === "zh" ? `难度 ${stars}` : `difficulty ${stars} of 4`}>
            {"★".repeat(stars)}
            <i>{"★".repeat(4 - stars)}</i>
          </span>
          <span className="sp-blurb">{partner.blurb[lang]}</span>
        </span>
        <span className="sp-record">
          {record
            ? lang === "zh"
              ? `${record.w}胜 ${record.l}负`
              : `${record.w}W ${record.l}L`
            : lang === "zh"
              ? "未交手"
              : "new"}
        </span>
      </button>
    </Wrap>
  );
}

/** Today's challenge: the same partner and the same seed for everyone, the seed from X Layer (PRD F19, F22). */
export function DailyCard({
  pet,
  onStart,
}: {
  pet: Pet;
  onStart: (partner: Partner, seed: number, day: number) => void;
}) {
  const lang = useLang((s) => s.lang) as Lang;
  const { status, block, seed, partnerIndex, best, load } = useDaily();
  useEffect(() => {
    void load();
  }, [load]);
  const partner = PARTNERS[partnerIndex]!;
  const art = useMemo(
    () => drawPet(partner.line, partner.stage, { expression: "proud" }),
    [partner.line, partner.stage],
  );
  return (
    <section className="sp-daily" aria-label={lang === "zh" ? "每日挑战" : "Daily challenge"}>
      <span className="sp-portrait">
        <PetArt canvas={art} line={partner.line} palette={coloursOf(partner)} scale={2} label={partner.name[lang]} />
      </span>
      <div className="sp-daily-text">
        <p className="label">
          {lang === "zh" ? "今日挑战 · 所有人同一场" : "Today's challenge · the same fight for everyone"}
        </p>
        <b>{lang === "zh" ? `${pet.name} 对 ${partner.name.zh}` : `${pet.name} vs ${partner.name.en}`}</b>
        <span className="small">
          {status === "ready" && block ? (
            <>
              {lang === "zh" ? "种子来自今天 X Layer 的第一个区块 " : "Seed from today's first X Layer block "}
              <a href={`https://www.oklink.com/xlayer/block/${block.block}`} target="_blank" rel="noopener noreferrer">
                #{block.block}
              </a>
            </>
          ) : status === "error" ? (
            lang === "zh" ? (
              "暂时连不上 X Layer，过一会儿再试。"
            ) : (
              "X Layer can't be reached right now; try again in a moment."
            )
          ) : lang === "zh" ? (
            "正在从 X Layer 读取今天的种子……"
          ) : (
            "Reading today's seed from X Layer…"
          )}
        </span>
        {best && (
          <span className="small">
            {lang === "zh"
              ? `今天最好：${best.won ? "赢了" : "没赢"}，血量差 ${best.margin}`
              : `Today's best: ${best.won ? "a win" : "not a win yet"}, health margin ${best.margin}`}
          </span>
        )}
      </div>
      {status === "error" ? (
        <button type="button" className="btn" onClick={() => void load()}>
          {lang === "zh" ? "重试" : "Retry"}
        </button>
      ) : (
        <button
          type="button"
          className="btn primary"
          disabled={status !== "ready" || seed === null || !block}
          onClick={() => seed !== null && block && onStart(partner, seed, block.day)}
        >
          {lang === "zh" ? "挑战" : "Spar"}
        </button>
      )}
    </section>
  );
}
