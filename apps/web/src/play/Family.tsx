/**
 * Families: asking another owner to raise a little one together, saying yes or
 * no to such a request, welcoming the newborn, switching between your pets,
 * and the family tree.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { drawPet } from "@lingxi/art";
import { type Family, type ParentInfo, type Pet, BOND_LEVELS, BREED_COOLDOWN_DAYS, FAMILY_BOND_LEVEL, bondLevel, canBreed, childMemory, childRoom, createPet, dayOf, familyOf, mindBrain, parseCard, ruleSkillIds, stageOf } from "@lingxi/game";
import { useLang, useT } from "../i18n";
import { MAX_PETS, keptPetNames, useGame } from "../game/store";
import { type GivenConsent, deployment, petKey, publicClient, useChain } from "../game/chain";
import { type PartnerCheck, breedingTerms, checkPartner, formatBem } from "@lingxi/chain";
import { useLive } from "../game/live";
import { bondName, bondsOf, friendKey, useFriends } from "../game/friends";
import { play } from "../game/sound";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { Sprite } from "./Sprite";
import "./family.css";
import { now } from "../game/gameClock";
import { newbornInherits, proposalInherits } from "./inherits";

type Lang = "en" | "zh";
const LINES = ["gentle", "bold", "curious"] as const;
type Line = (typeof LINES)[number];
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (["baby", "child", "teen", "adult"].includes(s) ? s : "baby") as PetStage);
const today = (p: Pet) => dayOf(p, now());

/** Why this pet cannot start a family right now, or null if it can. */
export function familyBlock(pet: Pet, partnerStage: string, lang: Lang): string | null {
  // families belong to owners: a pet staying with a friend, or away at one, waits
  if (pet.sitting || pet.away) return lang === "zh" ? `${pet.name}正在朋友家做客，回家后才能养小宝宝。` : `${pet.name} is staying away from home; little ones wait until it is back with its owner.`;
  const r = canBreed(
    { stage: stageOf(pet, now()), generation: pet.family?.generation ?? 0, ...(pet.lastBredDay !== undefined ? { lastBredDay: pet.lastBredDay } : {}) },
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

/** Why two pets are not yet close enough for a family, or null when they are best friends. */
export function bondBlock(pet: Pet, points: number, other: string, lang: Lang): string | null {
  const level = bondLevel(points);
  if (level >= FAMILY_BOND_LEVEL) return null;
  const need = BOND_LEVELS[FAMILY_BOND_LEVEL]! - points;
  return lang === "zh"
    ? `${pet.name}和${other}要先成为${bondName(FAMILY_BOND_LEVEL, "zh")}（现在是${bondName(level, "zh")}，还差 ${need} 点）。多在一起玩、送心、切磋吧。`
    : `${pet.name} and ${other} need to be ${bondName(FAMILY_BOND_LEVEL, "en").toLowerCase()} first (now ${bondName(level, "en").toLowerCase()}, ${need} to go). Spend time together, send hearts, spar.`;
}

// a parent's capstone rules are part of the brain its half of the child REFs, so they travel with it
type AsParent = Pick<Pet, "name" | "line" | "lessons" | "instincts" | "growth" | "family" | "bornAt">;
const asParent = (p: AsParent): ParentInfo & { generation: number } => ({
  name: p.name,
  line: p.line,
  lessons: p.lessons,
  ...(p.instincts ? { instincts: p.instincts } : {}),
  ...(ruleSkillIds(p.growth).length ? { skills: ruleSkillIds(p.growth) } : {}),
  key: petKey(p),
  generation: p.family?.generation ?? 0,
});

/** Someone asked us: raise a little one together? */
export function ProposalDialog({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const proposal = useLive((s) => s.proposal);
  const reply = useLive((s) => s.reply);
  const replace = useGame((s) => s.replace);
  const [signing, setSigning] = useState(false);
  // what the proposer says about its pet is checked on X Layer before our wallet signs anything for it
  const [partner, setPartner] = useState<{ at: number; check: PartnerCheck } | null>(null);
  const claimed = proposal?.chain;
  useEffect(() => {
    if (!claimed || !deployment || !proposal) return;
    let live = true;
    const at = proposal.at;
    void checkPartner(publicClient, deployment, claimed).then((check) => live && setPartner({ at, check }));
    return () => {
      live = false;
    };
  }, [claimed, proposal]);
  if (!proposal) return null;
  const bonds = bondsOf(useFriends.getState().all, pet.bornAt);
  const block = familyBlock(pet, proposal.stage, lang) ?? bondBlock(pet, bonds[friendKey(proposal.from, proposal.name)]?.points ?? 0, proposal.name, lang);
  const mine = useChain.getState().infoOf(pet);
  const claimsChain = !!(mine && proposal.chain);
  const check = partner?.at === proposal.at ? partner.check : null;
  const onChain = claimsChain && check === "ok";
  return (
    <div className="fam-modal" role="dialog" aria-label={lang === "zh" ? "家人请求" : "Family request"}>
      <motion.div className="fam-card" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
        <h3>{lang === "zh" ? "一起养个小宝宝？" : "Raise a little one together?"}</h3>
        <p>
          {lang === "zh"
            ? `${proposal.name}的主人想让${proposal.name}和${pet.name}一起养一只小宝宝。小宝宝的心智由它们俩完整的心智拼成，会住在对方家里。`
            : `${proposal.name}'s owner would like ${proposal.name} and ${pet.name} to raise a little one. Its mind will be built from both of theirs, whole, and it will live with them.`}
        </p>
        {/* which of this pet's lessons go into the little one, said before the player agrees (A27) */}
        <p className="small fam-inherits">{proposalInherits(pet.name, pet.lessons.length, lang)}</p>
        <p className="small">
          {lang === "zh" ? `之后${pet.name}要休息 ${BREED_COOLDOWN_DAYS} 天。` : `${pet.name} will rest for ${BREED_COOLDOWN_DAYS} days afterwards.`}
        </p>
        {claimsChain && check === null && <p className="small">{lang === "zh" ? "正在 X Layer 上核对对方的宠物……" : "Checking their pet on X Layer…"}</p>}
        {onChain && (
          // who the consent is really for (A63): the wallet that owns that pet on X Layer, whoever is asking in the room
          <div className="fam-consent-to">
            <p className="small">
              {lang === "zh"
                ? `两只宠物都在链上：同意时会用你的钱包签一次授权。授权给的是 X Layer 上 ${proposal.chain!.petId} 号宠物主人的钱包，不论房间里提问的是谁：`
                : `Both pets live on chain: saying yes signs one consent with your wallet. It goes to the wallet that owns pet #${proposal.chain!.petId} on X Layer, whoever is asking in this room:`}
            </p>
            <code className="fam-address">{proposal.chain!.owner}</code>
            <p className="small">
              {lang === "zh"
                ? `这个钱包之后可以和${pet.name}在链上养一只小宝宝。授权一直有效，直到用掉、${pet.name}被卖出，或你在宠物页的“家人”里撤回。`
                : `That wallet may then raise one little one with ${pet.name} on chain. The consent stands until it is used, ${pet.name} is sold, or you withdraw it (Family, on the pet sheet).`}
            </p>
          </div>
        )}
        {claimsChain && check !== null && check !== "ok" && (
          <p className="small warn">
            {check === "unreadable"
              ? lang === "zh"
                ? "现在读不到 X Layer，没法核对对方的宠物，所以不会签任何东西；同意的话，小宝宝只在游戏里出生。"
                : "X Layer can't be read just now to check their pet, so nothing will be signed; saying yes makes the little one in the game only."
              : lang === "zh"
                ? "对方发来的宠物信息和 X Layer 上的不符，所以不会签任何东西；同意的话，小宝宝只在游戏里出生。"
                : "What they sent about their pet doesn't match X Layer, so nothing will be signed; saying yes makes the little one in the game only."}
          </p>
        )}
        {block && <p className="small warn">{block}</p>}
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!!block || signing || (claimsChain && check === null)}
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
  const t = useT();
  const answer = useLive((s) => s.answer);
  const clear = useLive((s) => s.clearFamily);
  const adopt = useGame((s) => s.adopt);
  const replace = useGame((s) => s.replace);
  const [name, setName] = useState("");
  const [hatching, setHatching] = useState<"idle" | "busy" | string>("idle");
  // a little one born on chain whose first day did not save there: its name, while the player is told (A33)
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const chainBusy = useChain((s) => s.busy);
  // the BEM breeder's fee, read once; null on the free breeder or before it is read
  const [fee, setFee] = useState<bigint | null>(null);
  useEffect(() => {
    if (!deployment?.breederBem) return;
    let live = true;
    void breedingTerms(publicClient, deployment).then((t) => live && setFee(t?.fee ?? null), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  const partnerIsChild = useMemo(() => !!(answer?.card && parseCard(answer.card)?.family), [answer]);
  // our half of the child: what the pet has learnt, not its meters, so the family is not rebuilt every beat
  const { name: petName, line: petLine, lessons, instincts, growth, family: petFamily, bornAt } = pet;
  const family = useMemo<Family | null>(() => {
    if (!answer?.yes || !answer.card) return null;
    const line = LINES.find((l) => l === answer.line);
    const card = parseCard(answer.card);
    if (!line || !card) return null;
    try {
      return familyOf(asParent({ name: petName, line: petLine, lessons, instincts, growth, family: petFamily, bornAt }), { name: answer.name, line, lessons: card.lessons, ...(card.instincts ? { instincts: card.instincts } : {}), ...(ruleSkillIds(card.growth).length ? { skills: ruleSkillIds(card.growth) } : {}), generation: card.family?.generation ?? 0 });
    } catch {
      return null;
    }
  }, [answer, petName, petLine, lessons, instincts, growth, petFamily, bornAt]);
  if (!answer) return null;
  if (unsaved) {
    return (
      <div className="fam-modal" role="dialog" aria-label={lang === "zh" ? "新生的小宝宝" : "A newborn"}>
        <div className="fam-card">
          <h3>{lang === "zh" ? `${unsaved}在 X Layer 上出生了` : `${unsaved} was born on X Layer`}</h3>
          <p className="small fam-unsaved">
            {lang === "zh"
              ? `只是它的第一天还没存到链上，所以链上暂时把它显示成一颗蛋，各项数值都是 0。打开${unsaved}的「宠物」页，点「把今天存上链」就好。`
              : `Its first day isn't saved there yet, so for now X Layer shows it as an egg with every meter at 0. Open ${unsaved}'s Pet tab and press "Save today on chain" to put that right.`}
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setUnsaved(null);
              clear();
            }}
          >
            {lang === "zh" ? "好的" : "OK"}
          </button>
        </div>
      </div>
    );
  }
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
  const room = childRoom(family);
  const baby = drawPet(a.line as Line, "baby", { expression: "sparkly" });
  const partnerChain = answer.chain;
  const canChain = !!(partnerChain && useChain.getState().infoOf(pet));
  const welcome = async (offChain = false) => {
    const brain = mindBrain({ line: a.line, lessons: [], family });
    const born = createPet({ name: name.trim().slice(0, 12) || (lang === "zh" ? "小宝" : "Bean"), line: a.line, now: now(), tzOffsetMin: -new Date(now()).getTimezoneOffset(), brain });
    let child: Pet = { ...born, family, brain: childMemory(brain.nState, pet.brain, parseCard(answer.card ?? "")?.memory) };
    let firstDay = true;
    if (canChain && !offChain) {
      setHatching("busy");
      const r = await useChain.getState().breed(pet, partnerChain!, child);
      if (!r.ok) return setHatching(r.reason);
      // the chain mixed the parents' memories from their last checkpoints; the chain's version wins
      if (r.memory.length === brain.nState) child = { ...child, brain: r.memory };
      firstDay = r.firstDay;
    }
    replace({ ...pet, lastBredDay: today(pet) });
    if (adopt(child)) play("success");
    // born, but its first day is not on chain: say so and how to put it right before the dialog closes (A33)
    if (!firstDay) return setUnsaved(child.name);
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
            ? `白天它像${a.name}，心情也随${a.name}；夜里它像${b.name}，小习惯随${b.name}。`
            : `By day it acts like ${a.name}, with ${a.name}'s moods; by night like ${b.name}, with ${b.name}'s habits.`}
        </p>
        {/* what it inherits, and whether it can learn yet, said before it is welcomed (A27) */}
        <p className="small fam-inherits">{newbornInherits(a, b, room, lang)}</p>
        <label className="fam-name">
          <span>{lang === "zh" ? "给它起个名字" : "Give it a name"}</span>
          <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder={lang === "zh" ? "小宝" : "Bean"} autoFocus />
        </label>
        {canChain && !chainError && (
          <p className="small">
            {lang === "zh"
              ? "它会在链上出生：先刻好它的电路，再由繁育合约核对父母并孵化。出生后钱包会再请你签一次，把它的第一天存上链，这样链上显示的就是它本来的样子，而不是一颗蛋。"
              : "It will be born on chain: its circuit is taped out, then the Breeder checks both parents and hatches it. Then your wallet asks once more, to save its first day there, so X Layer shows it as itself rather than an egg."}
            {fee !== null &&
              (lang === "zh"
                ? ` 链上出生要 ${formatBem(fee)} BEM，这笔钱会被销毁；钱包可能先请你允许取用正好这么多。`
                : ` Being born on chain costs ${formatBem(fee)} BEM, which is burned; your wallet may first ask you to allow exactly that much.`)}
          </p>
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
                : chainError === "tooManyChildren"
                  ? lang === "zh"
                    ? "每只宠物一生最多有 4 个孩子，其中一位已经满了。"
                    : "Each pet can have at most four little ones in its life, and one of these two already has."
                  : chainError === "feeMoved"
                    ? lang === "zh"
                      ? "链上出生的费用刚刚变了，所以什么都没有花。再试一次，会按新的费用。"
                      : "The fee for being born on chain changed just now, so nothing was spent. Try again at the new fee."
                  : chainError === "notYours"
                    ? lang === "zh"
                      ? "链上显示这只宠物已经不在这个钱包里了，所以小宝宝没法出生。请连接拥有它的钱包。"
                      : "On chain this pet is no longer held by this wallet, so the little one can't be born. Connect the wallet that owns it."
                  : chainError === "birthPending"
                    ? lang === "zh"
                      ? "出生已经发到 X Layer，还在确认。不会再发第二次：过一分钟再点“再试一次”，灵犀会把它认领回来；如果你先关了页面，下次打开时它也会自己回来。"
                      : "The birth was sent to X Layer and isn't confirmed yet. Nothing will be sent twice: press Try again in a minute and Lingxi picks it up; if you close the page first, it comes home the next time you open the game."
                  : chainError === "birthUnchecked"
                    ? lang === "zh"
                      ? "出生之前已经发到 X Layer，现在暂时连不上它查看结果。没有再发新的：过一分钟再点“再试一次”，灵犀会把它认领回来。"
                      : "The birth was sent to X Layer earlier, and X Layer can't be reached to check on it right now. Nothing new was sent: press Try again in a minute and Lingxi picks it up."
                  : chainError === "noConsent"
                    ? lang === "zh"
                      ? "对方还没在链上签下同意（或者那只宠物已经换了主人），所以小宝宝没法在链上出生。"
                      : "The other owner's consent isn't on chain (or their pet has changed hands), so the little one can't be born on chain."
                  : chainError === "partnerNotOnChain"
                    ? lang === "zh"
                      ? "对方宠物的信息和 X Layer 上的不符，所以没有花任何东西。"
                      : "Their pet's details don't match X Layer, so nothing was spent."
                  : chainError === "cannotReceive"
                    ? t("chain.cannotReceive")
                  : chainError === "notEnoughBem"
                    ? lang === "zh"
                      ? `这个钱包在 X Layer 上的 BEM 不够付 ${fee !== null ? formatBem(fee) : ""} BEM 的出生费用。`
                      : `This wallet doesn't hold the ${fee !== null ? formatBem(fee) : ""} BEM for being born on chain.`
                : lang === "zh"
                  ? `链上出生没成功（${chainError}）。`
                  : `Being born on chain didn't work (${chainError}).`}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn primary" disabled={hatching === "busy"} onClick={() => void welcome()}>
            {hatching === "busy" ? (chainBusy === "saving" ? (lang === "zh" ? "正在保存它的第一天……" : "Saving its first day…") : lang === "zh" ? "正在链上出生……" : "Being born on chain…") : chainError ? (lang === "zh" ? "再试一次" : "Try again") : lang === "zh" ? "欢迎回家" : "Welcome home"}
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
  const kept = keptPetNames();
  return (
    <>
      <ul className="fam-pets">
        {pets.map((p, i) => {
          const stage = stageOf(p, now());
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
                <Sprite canvas={drawPet(p.line, drawn(stage), { expression: p.asleep ? "asleep" : "happy", ...(p.form ? { form: p.form } : {}) })} palette={PALETTE_OF[p.line]} scale={1.5} />
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
      {kept.length > 0 && (
        <p className="fam-kept" role="note">
          {lang === "zh"
            ? `${kept.join("、")}由更新版本的灵犀保存，这里读不了，所以原样保管着，不会丢。刷新页面换到最新版本，就能和${kept.length === 1 ? "它" : "它们"}一起玩。`
            : `${kept.join(", ")} ${kept.length === 1 ? "was" : "were"} saved by a newer Lingxi, which this page can't read, so ${kept.length === 1 ? "it is" : "they are"} kept safe exactly as saved. Reload the page for the newest version to play with ${kept.length === 1 ? "it" : "them"}.`}
        </p>
      )}
    </>
  );
}

/** Parents and children of the pet on screen. */
/** The consents standing for a pet on X Layer, each confirmed on its breeder, with a way to withdraw one (A63). */
function ConsentsOnChain({ pet, lang }: { pet: Pet; lang: Lang }) {
  const record = useChain((s) => s.recordOf(pet));
  const busy = useChain((s) => s.busy);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [read, setRead] = useState(0);
  // what was read, and for which pet and which reading: anything else on screen is still being read
  const reading = `${record?.petId ?? ""}:${read}`;
  const [got, setGot] = useState<{ for: string; value: { consents: GivenConsent[]; partial: boolean } | null } | null>(null);
  useEffect(() => {
    if (!record) return;
    let live = true;
    void useChain
      .getState()
      .consentsOf(pet)
      .then((value) => live && setGot({ for: reading, value }));
    return () => {
      live = false;
    };
    // the pet's record and each new reading, not every change to the pet, decide what is read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading]);
  if (!record) return null;
  const state = got?.for === reading ? got.value : "reading";
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  return (
    <div className="fam-consents" data-state={state === "reading" ? "reading" : state === null ? "unread" : "read"}>
      <p className="label">{lang === "zh" ? "链上的授权" : "Consents on X Layer"}</p>
      {state === "reading" ? (
        <p className="small">{lang === "zh" ? "正在读取 X Layer 上的授权……" : "Reading the consents on X Layer…"}</p>
      ) : state === null ? (
        <p className="small">{lang === "zh" ? "现在读不到 X Layer，所以列不出授权。过一会儿再看。" : "X Layer can't be read just now, so its consents can't be listed. Look again in a moment."}</p>
      ) : state.consents.length === 0 ? (
        <p className="small">
          {lang === "zh" ? `没有钱包能不经再次同意就和${pet.name}在链上养小宝宝。` : `No wallet may raise a little one with ${pet.name} on chain without asking again.`}
        </p>
      ) : (
        <ul className="fam-consent-list">
          {state.consents.map((c) => {
            const id = `${c.breeder}:${c.partner}`;
            return (
              <li key={id}>
                <span className="small">
                  {lang === "zh" ? (
                    <>
                      <code className="fam-address" title={c.partner}>{short(c.partner)}</code> 可以和{pet.name}养一只小宝宝
                    </>
                  ) : (
                    <>
                      <code className="fam-address" title={c.partner}>{short(c.partner)}</code> may raise one little one with {pet.name}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={withdrawing !== null || busy !== "idle"}
                  onClick={async () => {
                    play("tap");
                    setWithdrawing(id);
                    setFailed(false);
                    const ok = await useChain.getState().withdraw(pet, c);
                    setWithdrawing(null);
                    if (ok) play("success");
                    else setFailed(true);
                    setRead((n) => n + 1);
                  }}
                >
                  {withdrawing === id ? (lang === "zh" ? "撤回中……" : "Withdrawing…") : lang === "zh" ? "撤回" : "Withdraw"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {failed && <p className="small warn">{lang === "zh" ? "授权没有撤回，它仍然有效。可以再试一次。" : "The consent wasn't withdrawn and still stands. You can try again."}</p>}
      {state !== "reading" && state?.partial && (
        <p className="small">{lang === "zh" ? "服务器还在读取 X Layer 上较早的记录，以前在别的设备上给的授权可能还没列出。" : "The server is still reading X Layer's older records, so a consent given earlier on another device may not be listed yet."}</p>
      )}
    </div>
  );
}

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
      <ConsentsOnChain pet={pet} lang={lang} />
    </div>
  );
}
