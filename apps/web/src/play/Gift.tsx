/**
 * Gifts carried by pets: wrap a letter, an egg (a little sibling of your pet)
 * and an item into a link; a friend opening the link watches your pet arrive,
 * reads the letter and hatches the egg, with no wallet and no sign-up.
 */

import { linkPrefix } from "../game/links";
import { useBadges } from "../game/badges";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { drawEgg, drawPet } from "@lingxi/art";
import { type Gift, type Pet, LETTER_MAX, createPet, decodeGift, encodeGift, mindBrain, newGiftId, stageOf } from "@lingxi/game";
import { ITEM } from "@lingxi/world";
import { useLang } from "../i18n";
import { useGame } from "../game/store";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { Sprite } from "./Sprite";
import { Icon } from "./icons";
import "./gift.css";

type Lang = "en" | "zh";
const OPENED_KEY = "lingxi.gifts.opened.v1";
const EGG_SPOTS = { gentle: "coral", bold: "sky", curious: "sunny" } as const;
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (["baby", "child", "teen", "adult"].includes(s) ? s : "baby") as PetStage);

function openedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function markOpened(id: string): void {
  // the link has done its job; a reload must not offer the same gift again
  history.replaceState(null, "", location.pathname + location.search);
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify([...openedIds().slice(-200), id]));
  } catch {
    // private mode: the gift may be opened again on this visit only
  }
}

/** Wrap a gift in the Pet sheet. */
export function SendGiftPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const bag = useWorld((s) => s.world.bag);
  const wrap = useWorld((s) => s.wrap);
  const [letter, setLetter] = useState("");
  const [egg, setEgg] = useState(true);
  const [item, setItem] = useState<number | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const items = Object.entries(bag).filter(([id, n]) => n > 0 && ITEM[Number(id)]);
  const canSend = letter.trim().length > 0 || egg || item !== null;

  const send = () => {
    if (item !== null && !wrap(item, 1)) return;
    const gift: Gift = {
      id: newGiftId(),
      from: { name: pet.name, line: pet.line, stage: stageOf(pet, Date.now()) },
      letter: letter.trim().slice(0, LETTER_MAX),
      ...(egg && !pet.sitting ? { egg: { line: pet.line, lessons: pet.lessons } } : {}),
      ...(item !== null ? { item: { id: item, n: 1 } } : {}),
      at: Date.now(),
    };
    setLink(`${linkPrefix("play.html")}gift=${encodeGift(gift)}`);
    useBadges.getState().note("gifts");
    setItem(null);
    play("success");
  };

  if (link) {
    return (
      <div className="chainpanel gift-send">
        <p className="label">{lang === "zh" ? "礼物包好了" : "Gift wrapped"}</p>
        <p className="small">
          {lang === "zh" ? `把这个链接发给朋友，${pet.name}会把礼物送过去。` : `Send this link to a friend and ${pet.name} will carry the gift to them.`}
        </p>
        <div className="row">
          <input className="invite" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={lang === "zh" ? "礼物链接" : "Gift link"} />
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              try {
                if (navigator.share) await navigator.share({ title: lang === "zh" ? `${pet.name}送来的礼物` : `A gift from ${pet.name}`, url: link });
                else {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                }
                play("success");
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? (lang === "zh" ? "已复制" : "Copied") : lang === "zh" ? "发送" : "Share"}
          </button>
        </div>
        <button type="button" className="btn" onClick={() => (setLink(null), setLetter(""), setCopied(false))}>
          {lang === "zh" ? "再包一份" : "Wrap another"}
        </button>
      </div>
    );
  }

  return (
    <div className="chainpanel gift-send">
      <p className="label">{lang === "zh" ? "送礼物" : "Send a gift"}</p>
      <label className="gift-letter">
        <span className="small">{lang === "zh" ? "写一封信" : "Write a letter"}</span>
        <textarea value={letter} maxLength={LETTER_MAX} rows={3} onChange={(e) => setLetter(e.target.value)} placeholder={lang === "zh" ? "生日快乐！这是我的宠物送你的。" : "Happy birthday! This comes from my pet."} />
        <em>
          {letter.length}/{LETTER_MAX}
        </em>
      </label>
      <label className="gift-check" hidden={!!pet.sitting}>
        <input type="checkbox" checked={egg && !pet.sitting} disabled={!!pet.sitting} onChange={(e) => setEgg(e.target.checked)} />
        <span>
          {pet.lessons.length === 0
            ? lang === "zh"
              ? `放一颗蛋：${pet.name}的弟弟妹妹`
              : `Add an egg: a little sibling of ${pet.name}`
            : lang === "zh"
              ? `放一颗蛋：${pet.name}的弟弟妹妹，带着你教过${pet.name}的${pet.lessons.length}课`
              : `Add an egg: a little sibling of ${pet.name}, carrying the ${pet.lessons.length} lesson${pet.lessons.length === 1 ? "" : "s"} you taught it`}
        </span>
      </label>
      {items.length > 0 && (
        <div className="gift-items" role="group" aria-label={lang === "zh" ? "附上一件东西" : "Add an item"}>
          <span className="small">{lang === "zh" ? "附上一件东西（可选）" : "Add an item (optional)"}</span>
          <div className="gift-item-row">
            {items.slice(0, 12).map(([id, n]) => {
              const def = ITEM[Number(id)]!;
              const on = item === Number(id);
              return (
                <button key={id} type="button" className={`gift-item${on ? " on" : ""}`} aria-pressed={on} aria-label={`${def.name[lang]} ×${n}`} onClick={() => setItem(on ? null : Number(id))}>
                  <img className="pixel" src={def.art} alt="" width={32} height={32} />
                  <i>{n}</i>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button type="button" className="btn primary" disabled={!canSend} onClick={send}>
        {lang === "zh" ? "包好礼物" : "Wrap the gift"}
      </button>
    </div>
  );
}

/** A gift arriving by link: the sender's pet walks in carrying it. */
export function GiftArrival() {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const adopt = useGame((s) => s.adopt);
  const receive = useWorld((s) => s.receive);
  const [state, setState] = useState<{ gift: Gift; seen: boolean } | { error: string } | null>(null);
  const [step, setStep] = useState<"arrive" | "letter" | "egg" | "name" | "done">("arrive");
  const [name, setName] = useState("");

  useEffect(() => {
    const read = () => {
      const m = location.hash.match(/^#gift=(lxg1\.[A-Za-z0-9_-]+)$/);
      if (!m) return;
      try {
        const gift = decodeGift(m[1]!);
        setStep("arrive");
        setState({ gift, seen: openedIds().includes(gift.id) });
      } catch (e) {
        setState({ error: (e as Error).message });
      }
    };
    read();
    // a link opened in a tab that already shows the game only changes the hash
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    if (step !== "arrive" || !state || "error" in state) return;
    const id = setTimeout(() => setStep("letter"), reduce ? 200 : 1600);
    return () => clearTimeout(id);
  }, [step, state, reduce]);

  const close = () => {
    history.replaceState(null, "", location.pathname + location.search);
    setState(null);
  };
  const carrier = useMemo(() => (state && "gift" in state ? drawPet(state.gift.from.line, drawn(state.gift.from.stage), { expression: "sparkly" }) : null), [state]);
  if (!state) return null;
  if ("error" in state) {
    return (
      <div className="fam-modal" role="dialog">
        <div className="fam-card">
          <p>{lang === "zh" ? "这份礼物的链接坏了，打不开。" : "This gift's link is damaged and can't be opened."}</p>
          <button type="button" className="btn" onClick={close}>
            {lang === "zh" ? "好的" : "OK"}
          </button>
        </div>
      </div>
    );
  }
  const { gift, seen } = state;
  const def = gift.item ? ITEM[gift.item.id] : undefined;

  const unwrap = () => {
    play("pop");
    if (!seen && gift.item && def) receive(gift.item.id, gift.item.n);
    if (gift.egg && !seen) setStep("egg");
    else {
      markOpened(gift.id);
      setStep("done");
    }
  };
  const hatch = () => {
    const egg = gift.egg!;
    const brain = mindBrain({ line: egg.line, lessons: egg.lessons });
    const born = createPet({ name: name.trim().slice(0, 12) || (lang === "zh" ? "小礼" : "Present"), line: egg.line, now: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset(), brain });
    // the sibling starts with the lessons the sender taught; its log replays on that brain from the first beat
    const sibling: Pet = { ...born, lessons: egg.lessons.slice(), segments: [{ from: 0, lessons: egg.lessons.slice() }] };
    markOpened(gift.id);
    if (adopt(sibling)) play("success");
    setStep("done");
  };

  return (
    <div className="fam-modal gift-modal" role="dialog" aria-label={lang === "zh" ? "一份礼物" : "A gift"}>
      <motion.div className="fam-card gift-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <h3>{lang === "zh" ? `${gift.from.name}送来一份礼物` : `${gift.from.name} brought you a gift`}</h3>
        <div className="gift-stage">
          <motion.div className="gift-carrier" initial={reduce ? false : { x: -140 }} animate={{ x: 0 }} transition={{ duration: 1.2, ease: [0.23, 1, 0.32, 1] }}>
            {carrier && <Sprite canvas={carrier} palette={PALETTE_OF[gift.from.line]} scale={2.5} label={gift.from.name} />}
            <motion.span className="gift-parcel" aria-hidden="true" animate={reduce ? {} : { y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.9 }}>
              <Icon name="gift" size={30} />
            </motion.span>
          </motion.div>
        </div>
        <AnimatePresence mode="wait">
          {step === "letter" && (
            <motion.div key="letter" className="gift-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {gift.letter && <blockquote className="gift-letter-card">{gift.letter}</blockquote>}
              <ul className="gift-contents">
                {gift.egg && <li>{lang === "zh" ? `一颗蛋：${gift.from.name}的弟弟妹妹` : `An egg: a little sibling of ${gift.from.name}`}</li>}
                {def && <li>{lang === "zh" ? `${def.name.zh} ×${gift.item!.n}` : `${def.name.en} ×${gift.item!.n}`}</li>}
              </ul>
              {seen && <p className="small">{lang === "zh" ? "这份礼物在这台设备上已经拆过了。" : "This gift was already opened on this device."}</p>}
              <button type="button" className="btn primary" onClick={seen ? close : unwrap}>
                {seen ? (lang === "zh" ? "好的" : "OK") : lang === "zh" ? "拆开" : "Open it"}
              </button>
            </motion.div>
          )}
          {step === "egg" && (
            <motion.div key="egg" className="gift-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.button type="button" className="gift-egg" onClick={() => (play("pop"), setStep("name"))} animate={reduce ? {} : { rotate: [0, -6, 6, -4, 0] }} transition={{ repeat: Infinity, duration: 1.4 }} aria-label={lang === "zh" ? "点一下孵蛋" : "Tap to hatch"}>
                <Sprite canvas={drawEgg(EGG_SPOTS[gift.egg!.line])} palette={PALETTE_OF[gift.egg!.line]} scale={3} />
              </motion.button>
              <p className="small">{lang === "zh" ? "蛋在晃！点一下孵出来。" : "The egg is wobbling! Tap it to hatch."}</p>
            </motion.div>
          )}
          {step === "name" && (
            <motion.div key="name" className="gift-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Sprite canvas={drawPet(gift.egg!.line, "baby", { expression: "sparkly" })} palette={PALETTE_OF[gift.egg!.line]} scale={3} />
              <p className="small">
                {gift.egg!.lessons.length
                  ? lang === "zh"
                    ? `它已经会${gift.egg!.lessons.length}课，是${gift.from.name}的主人教的。`
                    : `It already knows ${gift.egg!.lessons.length} lesson${gift.egg!.lessons.length === 1 ? "" : "s"}, taught by ${gift.from.name}'s owner.`
                  : lang === "zh"
                    ? "它什么都还没学，等你来教。"
                    : "It hasn't learned anything yet. That's up to you."}
              </p>
              <label className="fam-name">
                <span>{lang === "zh" ? "给它起个名字" : "Give it a name"}</span>
                <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder={lang === "zh" ? "小礼" : "Present"} autoFocus />
              </label>
              <button type="button" className="btn primary" onClick={hatch}>
                {lang === "zh" ? "欢迎回家" : "Welcome home"}
              </button>
            </motion.div>
          )}
          {step === "done" && (
            <motion.div key="done" className="gift-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p>{lang === "zh" ? "收好啦！" : "All unwrapped!"}</p>
              <button type="button" className="btn primary" onClick={close}>
                {lang === "zh" ? "去看看" : "Let's see"}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
