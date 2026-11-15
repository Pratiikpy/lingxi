/**
 * Families: asking another owner to raise a little one together, saying yes or
 * no to such a request, welcoming the newborn, switching between your pets,
 * and the family tree.
 */

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { drawPet } from "@lingxi/art";
import { type Family, type ParentInfo, type Pet, BREED_COOLDOWN_DAYS, canBreed, childMemory, createPet, dayOf, familyOf, mindBrain, parseCard, stageOf } from "@lingxi/game";
import { useLang } from "../i18n";
import { MAX_PETS, useGame } from "../game/store";
import { petKey, useChain } from "../game/chain";
import { useLive } from "../game/live";
import { play } from "../game/sound";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { Sprite } from "./Sprite";
import "./family.css";

type Lang = "en" | "zh";
const LINES = ["gentle", "bold", "curious"] as const;
type Line = (typeof LINES)[number];
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (["baby", "child", "teen", "adult"].includes(s) ? s : "baby") as PetStage);
const today = (p: Pet) => dayOf(p, Date.now());

/** Why this pet cannot start a family right now, or null if it can. */
export function familyBlock(pet: Pet, partnerStage: string, lang: Lang): string | null {
  const r = canBreed(
    { stage: stageOf(pet, Date.now()), generation: pet.family?.generation ?? 0, ...(pet.lastBredDay !== undefined ? { lastBredDay: pet.lastBredDay } : {}) },
    { stage: (["baby", "child", "teen", "adult", "elder"].includes(partnerStage) ? partnerStage : "baby") as "baby" },
    today(pet),
  );
  if (r.ok) {
    if (useGame.getState().pets.length >= MAX_PETS) return lang === "zh" ? `你已经有 ${MAX_PETS} 只宠物了。` : `You already look after ${MAX_PETS} pets.`;
    return null;
  }
  if (r.reason === "secondGeneration")
    return lang === "zh" ? `${pet.name}是两只宠物的孩子，它的心智已经由两颗心智织成，不能再养小宝宝了。` : `${pet.name} was born of two parents. Its mind is already two minds woven together, so it can't have little ones of its own.`;
  if (r.reason === "notAdult") return lang === "zh" ? "两只宠物都要长大成年，才能一起养小宝宝。" : "Both pets need to be grown up before they can raise a little one.";
  return lang === "zh" ? `上次之后要休息 ${BREED_COOLDOWN_DAYS} 天。` : `Pets rest ${BREED_COOLDOWN_DAYS} days after having a little one.`;
}

const asParent = (p: Pet): ParentInfo & { generation: number } => ({ name: p.name, line: p.line, lessons: p.lessons, ...(p.instincts ? { instincts: p.instincts } : {}), key: petKey(p), generation: p.family?.generation ?? 0 });

/** Someone asked us: raise a little one together? */
export function ProposalDialog({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const proposal = useLive((s) => s.proposal);
  const reply = useLive((s) => s.reply);
  const replace = useGame((s) => s.replace);
  const [signing, setSigning] = useState(false);
  if (!proposal) return null;
  const block = familyBlock(pet, proposal.stage, lang);
  const mine = useChain.getState().infoOf(pet);
  const onChain = !!(mine && proposal.chain);
  return (
    <div className="fam-modal" role="dialog" aria-label={lang === "zh" ? "家人请求" : "Family request"}>
      <motion.div className="fam-card" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
        <h3>{lang === "zh" ? "一起养个小宝宝？" : "Raise a little one together?"}</h3>
        <p>
          {lang === "zh"
            ? `${proposal.name}的主人想让${proposal.name}和${pet.name}一起养一只小宝宝。小宝宝的心智由它们俩的心智拼成，会住在对方家里。`
            : `${proposal.name}'s owner would like ${proposal.name} and ${pet.name} to raise a little one. Its mind will be built from both of theirs, and it will live with them.`}
        </p>
        <p className="small">
          {lang === "zh" ? `之后${pet.name}要休息 ${BREED_COOLDOWN_DAYS} 天。` : `${pet.name} will rest for ${BREED_COOLDOWN_DAYS} days afterwards.`}
        </p>
        {onChain && (
          <p className="small">
            {lang === "zh" ? "两只宠物都在链上：同意时会用你的钱包签一次授权，让小宝宝在链上出生。" : "Both pets live on chain: saying yes signs one consent with your wallet so the little one is born on chain."}
          </p>
        )}
        {block && <p className="small warn">{block}</p>}
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!!block || signing}
            onClick={async () => {
              let chain = undefined;
              if (onChain) {
                setSigning(true);
                const ok = await useChain.getState().allow(pet, proposal.chain!.owner);
                setSigning(false);
                if (ok) chain = mine!;
              }
              play("success");
              replace({ ...pet, lastBredDay: today(pet) });
              reply(proposal.from, true, chain);
            }}
          >
            {signing ? (lang === "zh" ? "签名中……" : "Signing…") : lang === "zh" ? "好呀" : "Yes"}
          </button>
          <button type="button" className="btn" onClick={() => (play("tap"), reply(proposal.from, false))}>
            {lang === "zh" ? "现在不了" : "Not now"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/** The other owner said yes: meet and name the newborn. */
export function NewbornDialog({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const answer = useLive((s) => s.answer);
  const clear = useLive((s) => s.clearFamily);
  const adopt = useGame((s) => s.adopt);
  const replace = useGame((s) => s.replace);
  const [name, setName] = useState("");
  const [hatching, setHatching] = useState<"idle" | "busy" | string>("idle");
  const partnerIsChild = useMemo(() => !!(answer?.card && parseCard(answer.card)?.family), [answer]);
  const family = useMemo<Family | null>(() => {
    if (!answer?.yes || !answer.card) return null;
    const line = LINES.find((l) => l === answer.line);
    const card = parseCard(answer.card);
    if (!line || !card) return null;
    try {
      return familyOf(asParent(pet), { name: answer.name, line, lessons: card.lessons, ...(card.instincts ? { instincts: card.instincts } : {}), generation: card.family?.generation ?? 0 });
    } catch {
      return null;
    }
    // the answer is the event; the pet at that moment is the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);
  if (!answer) return null;
  if (!answer.yes || !family) {
    return (
      <div className="fam-modal" role="dialog">
        <div className="fam-card">
          <p>
            {!answer.yes
              ? lang === "zh"
                ? `${answer.name}的主人说现在还不行。`
                : `${answer.name}'s owner said not now.`
              : partnerIsChild
                ? lang === "zh"
                  ? `${answer.name}是两只宠物的孩子，不能再养小宝宝。`
                  : `${answer.name} was born of two parents, so it can't have little ones of its own.`
                : lang === "zh"
                  ? "它们的心智没法拼在一起。"
                  : "Their minds could not be put together."}
          </p>
          <button type="button" className="btn" onClick={clear}>
            {lang === "zh" ? "好的" : "OK"}
          </button>
        </div>
      </div>
    );
  }
  const [a, b] = family.parents;
  const baby = drawPet(a.line as Line, "baby", { expression: "sparkly" });
  const partnerChain = answer.chain;
  const canChain = !!(partnerChain && useChain.getState().infoOf(pet));
  const welcome = async (offChain = false) => {
    const brain = mindBrain({ line: a.line, lessons: [], family });
    const born = createPet({ name: name.trim().slice(0, 12) || (lang === "zh" ? "小宝" : "Bean"), line: a.line, now: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset(), brain });
    let child: Pet = { ...born, family, brain: childMemory(brain.nState, pet.brain, parseCard(answer.card ?? "")?.memory) };
    if (canChain && !offChain) {
      setHatching("busy");
      const r = await useChain.getState().breed(pet, partnerChain!, child);
      if (!r.ok) return setHatching(r.reason);
      // the chain mixed the parents' memories from their last checkpoints; the chain's version wins
      if (r.memory.length === brain.nState) child = { ...child, brain: r.memory };
    }
    replace({ ...pet, lastBredDay: today(pet) });
    if (adopt(child)) play("success");
    clear();
  };
  const chainError = hatching !== "idle" && hatching !== "busy" ? hatching : null;
  return (
    <div className="fam-modal" role="dialog" aria-label={lang === "zh" ? "新生的小宝宝" : "A newborn"}>
      <motion.div className="fam-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <h3>{lang === "zh" ? "一个小宝宝出生了！" : "A little one is born!"}</h3>
        <div className="fam-born">
          <ParentChip parent={a} when="day" lang={lang} />
          <motion.div className="fam-baby" initial={{ scale: 0.6 }} animate={{ scale: [0.6, 1.08, 1] }} transition={{ duration: 0.6 }}>
            <Sprite canvas={baby} palette={PALETTE_OF[a.line]} scale={3} label={lang === "zh" ? "小宝宝" : "the newborn"} />
          </motion.div>
          <ParentChip parent={b} when="night" lang={lang} />
        </div>
        <p className="small">
          {lang === "zh"
            ? `白天它像${a.name}，心情也随${a.name}；夜里它像${b.name}，小习惯随${b.name}。你教它的，两边都会学。`
            : `By day it acts like ${a.name}, with ${a.name}'s moods; by night like ${b.name}, with ${b.name}'s habits. Whatever you teach it, both halves learn.`}
        </p>
        <label className="fam-name">
          <span>{lang === "zh" ? "给它起个名字" : "Give it a name"}</span>
          <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder={lang === "zh" ? "小宝" : "Bean"} autoFocus />
        </label>
        {canChain && !chainError && (
          <p className="small">{lang === "zh" ? "它会在链上出生：先刻好它的电路，再由繁育合约核对父母并孵化。" : "It will be born on chain: its circuit is taped out, then the Breeder checks both parents and hatches it."}</p>
        )}
        {chainError && (
          <p className="small warn">
            {chainError === "notAdultOnChain"
              ? lang === "zh"
                ? "在链上，两只宠物都要上链满 7 天才算长大。"
                : "On chain, both pets must have lived there for 7 days to count as grown."
              : chainError === "tooSoon"
                ? lang === "zh"
                  ? "链上显示它们还在休息。"
                  : "The chain says they are still resting."
                : lang === "zh"
                  ? `链上出生没成功（${chainError}）。`
                  : `Being born on chain didn't work (${chainError}).`}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn primary" disabled={hatching === "busy"} onClick={() => void welcome()}>
            {hatching === "busy" ? (lang === "zh" ? "正在链上出生……" : "Being born on chain…") : chainError ? (lang === "zh" ? "再试一次" : "Try again") : lang === "zh" ? "欢迎回家" : "Welcome home"}
          </button>
          {chainError && (
            <button type="button" className="btn" onClick={() => void welcome(true)}>
              {lang === "zh" ? "先不上链，直接带回家" : "Bring it home off chain"}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function ParentChip({ parent, when, lang }: { parent: ParentInfo; when: "day" | "night"; lang: Lang }) {
  const art = useMemo(() => drawPet(parent.line as Line, "adult", { expression: "happy" }), [parent.line]);
  return (
    <div className="fam-parent">
      <Sprite canvas={art} palette={PALETTE_OF[parent.line as Line]} scale={1.5} />
      <b>{parent.name}</b>
      <small>{when === "day" ? (lang === "zh" ? "白天·心情" : "days · moods") : lang === "zh" ? "夜里·习惯" : "nights · habits"}</small>
    </div>
  );
}

/** All your pets; tap one to look after it. */
export function PetsPanel({ onPicked }: { onPicked: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const { pets, active, switchTo } = useGame();
  return (
    <ul className="fam-pets">
      {pets.map((p, i) => {
        const stage = stageOf(p, Date.now());
        return (
          <li key={p.bornAt}>
            <button
              type="button"
              className={`fam-pet${i === active ? " on" : ""}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => {
                play("tap");
                switchTo(i);
                onPicked();
              }}
            >
              <Sprite canvas={drawPet(p.line, drawn(stage), { expression: p.asleep ? "asleep" : "happy" })} palette={PALETTE_OF[p.line]} scale={1.5} />
              <span>
                <b>{p.name}</b>
                <small>
                  {lang === "zh" ? `第 ${p.family?.generation ?? 0} 代` : `Generation ${p.family?.generation ?? 0}`}
                  {p.family ? (lang === "zh" ? ` · ${p.family.parents[0].name}和${p.family.parents[1].name}的孩子` : ` · child of ${p.family.parents[0].name} & ${p.family.parents[1].name}`) : ""}
                </small>
              </span>
              {i === active && <em>{lang === "zh" ? "正在照顾" : "Here now"}</em>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Parents and children of the pet on screen. */
export function FamilyTree({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const pets = useGame((s) => s.pets);
  const key = petKey(pet);
  const children = pets.filter((p) => p.family?.parents.some((x) => x.key === key));
  const rest = pet.lastBredDay !== undefined ? BREED_COOLDOWN_DAYS - (today(pet) - pet.lastBredDay) : 0;
  return (
    <div className="fam-tree">
      <p className="label">{lang === "zh" ? "家人" : "Family"}</p>
      {pet.family ? (
        <div className="fam-row">
          <ParentChip parent={pet.family.parents[0]} when="day" lang={lang} />
          <span className="fam-plus" aria-hidden="true">
            +
          </span>
          <ParentChip parent={pet.family.parents[1]} when="night" lang={lang} />
        </div>
      ) : (
        <p className="small">{lang === "zh" ? `${pet.name}是第一代，从蛋里孵出来的。` : `${pet.name} is first generation, hatched from an egg.`}</p>
      )}
      {children.length > 0 && (
        <p className="small">
          {lang === "zh" ? "孩子：" : "Children: "}
          {children.map((c) => c.name).join(lang === "zh" ? "、" : ", ")}
        </p>
      )}
      <p className="small">
        {pet.family
          ? lang === "zh"
            ? "它的心智由父母两颗心智织成，所以它自己不会再有小宝宝。"
            : "Its mind is woven from both parents', so it won't have little ones of its own."
          : rest > 0
          ? lang === "zh"
            ? `还要休息 ${rest} 天才能再养小宝宝。`
            : `Resting for ${rest} more day${rest === 1 ? "" : "s"} before another little one.`
          : lang === "zh"
            ? "长大后，和朋友的宠物在同一个房间时，点它就能问能不能一起养小宝宝。"
            : "Once grown, tap a friend's pet in the same room to ask about raising a little one together."}
      </p>
    </div>
  );
}
