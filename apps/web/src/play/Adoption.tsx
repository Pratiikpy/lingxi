/**
 * The adoption centre (plan 4.8). A breeder can offer a little one they hatched while it is still young; anyone
 * can adopt one for BEM. Every offer's papers are checked against X Layer in this browser before it can be paid
 * for. The waiting card shows on the breeder's side while the little one is at the centre.
 */

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { type AdoptionTerms, formatBem, parseBem, refusesTokens } from "@lingxi/chain";
import type { Pet, PapersProblem } from "@lingxi/game";
import { boundingBox, drawPet } from "@lingxi/art";
import { useLang, useT } from "../i18n";
import { recordOf } from "../game/chain";
import { type CheckedOffer, type Farewell, adoptFromCentre, takeFarewells, adoptionAvailable, atCentre, browseOffers, centreTerms, checkCentre, offerForAdoption, papersAvailable, withdrawFromCentre } from "../game/adoption";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";
import "./adoption.css";
import { now } from "../game/gameClock";

type Lang = "en" | "zh";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const DAY = 86_400;

function Little({ line, ageDays }: { line: Pet["line"]; ageDays: number }) {
  const art = useMemo(() => {
    const canvas = drawPet(line, ageDays >= 1 ? "child" : "baby", { expression: "happy" });
    const b = boundingBox(canvas);
    return { canvas, crop: { x: Math.max(0, b.x - 1), y: Math.max(0, b.y - 1), w: b.w + 2, h: b.h + 2 } };
  }, [line, ageDays]);
  return <Sprite canvas={art.canvas} palette={PALETTE_OF[line]} scale={3} crop={art.crop} />;
}

const PROBLEM: Record<PapersProblem | "noPapers" | "unreachable", [string, string]> = {
  noPapers: ["Its papers are not at the centre yet, so it cannot be adopted.", "它的资料还没送到领养中心，暂时不能领养。"],
  unreachable: ["X Layer could not be read just now.", "暂时读不到 X Layer。"],
  notAChild: ["Its papers are not a bred little one's.", "它的资料不是一个出生的小宝宝的。"],
  outsideInstinct: ["A little one with a borrowed instinct cannot be adopted here.", "带有借来本能的小宝宝不能在这里领养。"],
  line: ["Its papers name a different line than X Layer.", "它的资料和 X Layer 上的品种不一样。"],
  parents: ["Its papers name different parents than X Layer.", "它的资料和 X Layer 上的父母不一样。"],
  brain: ["Its papers describe a different mind than the circuit on X Layer.", "它的资料描述的心智和 X Layer 上的电路不一样。"],
  log: ["Its papers' thoughts do not follow on from the ones saved on X Layer.", "它资料里的念头接不上 X Layer 上存下的念头。"],
  memory: ["Its papers' memory is not what its thoughts lead to.", "它资料里的记忆和它的念头对不上。"],
  record: ["Its papers claim more than X Layer saved.", "它的资料比 X Layer 上存下的多。"],
  growth: ["Its papers' level and skills are not possible.", "它资料里的等级和技能不可能存在。"],
};

export function AdoptionPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const t = useT();
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [terms, setTerms] = useState<AdoptionTerms | null>(null);
  const [offers, setOffers] = useState<CheckedOffer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("0.5");

  const unreadable = () => {
    setOffers([]);
    setNote(L("The adoption centre couldn't be read just now.", "暂时读不到领养中心。"));
  };
  const read = () => browseOffers().then(setOffers, unreadable);
  // the centre is read once when the panel opens; the note is in the language of that moment
  const sayUnreadable = useEffectEvent(unreadable);
  useEffect(() => {
    if (!adoptionAvailable()) return;
    void centreTerms().then(setTerms, () => setTerms(null));
    void browseOffers().then(setOffers, () => sayUnreadable());
  }, []);
  if (!adoptionAvailable()) return null;

  const record = recordOf(pet);
  const bornSec = record?.bornChain ?? 0;
  const nowSec = Math.floor(now() / 1000);
  const youngLeft = terms ? bornSec + terms.youngAge - nowSec : 0;
  const canOffer = !!record && !!pet.family && !pet.away && !pet.sitting && !pet.outside && youngLeft > 3600 && papersAvailable();
  const units = parseBem(price);
  const priceOk = !!terms && units !== null && units >= terms.minPrice && units <= terms.maxPrice;
  const split = (p: bigint) => (terms ? { burned: (p * BigInt(terms.feeBps) + 9_999n) / 10_000n, share: (p * BigInt(terms.coParentBps)) / 10_000n } : { burned: 0n, share: 0n });

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setNote("");
    try {
      setNote(await fn());
      play("success");
    } catch (e) {
      play("error");
      const m = (e as Error).message;
      setNote(
        m === "noWallet"
          ? L("No wallet found in this browser. Open Lingxi in the OKX Wallet app, or a browser with a wallet.", "这个浏览器里没有钱包。请在 OKX 钱包应用里打开灵犀，或用装了钱包的浏览器。")
          : m === "notEnoughBem"
            ? L("This wallet doesn't hold enough BEM on X Layer for that.", "这个钱包在 X Layer 上的 BEM 不够。")
            : refusesTokens(e)
              ? t("chain.cannotReceive")
              : L(`That didn't go through: ${m.split("\n")[0]}`, `没有成功：${m.split("\n")[0]}`),
      );
    }
    setBusy(null);
  };

  const offer = () =>
    run("offer", async () => {
      const until = bornSec + (terms?.youngAge ?? 3 * DAY) - 60;
      const r = await offerForAdoption(pet, units!, until, (s) =>
        setNote(
          s === "saving"
            ? L("Saving today first…", "先存一下今天……")
            : s === "listing"
              ? L("Allow the centre to move this one pet, then confirm the offer in your wallet.", "请在钱包里允许领养中心移动这一只宠物，再确认挂出。")
              : s === "signing"
                ? L("Sign its papers in your wallet (no fee).", "请在钱包里签署它的资料（不花钱）。")
                : L("Leaving its papers at the centre…", "正在把资料送到领养中心……"),
        ),
      );
      if (!r.ok) throw new Error(r.reason);
      await read();
      return L(`${pet.name} is waiting at the adoption centre.`, `${pet.name}正在领养中心等待。`);
    });

  const adopt = (c: CheckedOffer) =>
    run(`adopt:${c.offer.petId}`, async () => {
      const r = await adoptFromCentre(c);
      if (!r.ok) throw new Error(r.reason === "full" ? L("You already have eight pets.", "你已经有八只宠物了。") : r.reason === "own" ? L("That one is yours.", "这只是你的。") : r.reason);
      await read();
      return L(`${r.pet.name} came home with you.`, `${r.pet.name}跟你回家了。`);
    });

  const live = (offers ?? []).filter((c) => c.offer.live);
  return (
    <div className="chainpanel adoption">
      <p className="label">{L("Adoption centre", "领养中心")}</p>
      <p className="small">
        {L(
          "Little ones a breeder hatched and has not raised, offered while they are still young. A pet someone raised is never for sale here. Of the price, 3% is burned, 10% goes to the owner of the other parent, and the rest to the breeder. Every little one's papers are checked against X Layer in your browser before you can adopt it. A name colour is not part of the price: the breeder can change it until the adoption goes through.",
          "饲养者孵出、还没养大的小宝宝，趁它们还小的时候送出领养。被人养大的宠物永远不会在这里出售。价格的 3% 会被销毁，10% 给另一位父母的主人，其余归饲养者。每个小宝宝的资料都会先在你的浏览器里和 X Layer 核对，然后才能领养。名字颜色不算在价格里：领养完成之前，饲养者都可以改它。",
        )}
      </p>
      {!papersAvailable() && <p className="small sp-warn">{L("Offering and adopting need the web version at lingxi.knole.me, which keeps the papers.", "送养和领养需要用网页版 lingxi.knole.me，由它保管资料。")}</p>}

      {canOffer && terms && (
        <form
          className="adoption-offer"
          onSubmit={(e) => {
            e.preventDefault();
            if (priceOk) void offer();
          }}
        >
          <b>{L(`Offer ${pet.name} for adoption`, `把${pet.name}送去领养`)}</b>
          <span className="small">
            {L(
              `It can wait at the centre for ${Math.max(1, Math.floor(youngLeft / 3600))} more hours, while it is still young. It stays frozen there; if nobody adopts it, it comes back to you.`,
              `趁它还小，它还能在领养中心等 ${Math.max(1, Math.floor(youngLeft / 3600))} 个小时。它在那里会暂停；如果没人领养，它会回到你身边。`,
            )}
          </span>
          <label className="adoption-price">
            <span>{L("Price (BEM)", "价格（BEM）")}</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          {priceOk && (
            <span className="small">
              {L(
                `${formatBem(split(units!).burned)} burned · up to ${formatBem(split(units!).share)} to the other parent's owner · the rest to you`,
                `销毁 ${formatBem(split(units!).burned)} · 最多 ${formatBem(split(units!).share)} 给另一位父母的主人 · 其余归你`,
              )}
            </span>
          )}
          {!priceOk && <span className="small sp-warn">{L(`Between ${formatBem(terms.minPrice)} and ${formatBem(terms.maxPrice)} BEM.`, `在 ${formatBem(terms.minPrice)} 到 ${formatBem(terms.maxPrice)} BEM 之间。`)}</span>}
          <button type="submit" className="btn primary" disabled={!priceOk || busy !== null}>
            {busy === "offer" ? L("Offering…", "送养中……") : L("Offer", "送养")}
          </button>
        </form>
      )}

      {offers === null ? (
        <p className="small">{L("Reading the centre…", "正在读取领养中心……")}</p>
      ) : live.length === 0 ? (
        <p className="small">{L("No little ones are waiting right now.", "现在没有等待领养的小宝宝。")}</p>
      ) : (
        <ul className="adoption-grid">
          {live.map((c) => {
            const p = c.papers?.pet;
            const age = Math.max(0, Math.floor((nowSec - c.offer.pet.born) / 3600));
            const s = split(c.offer.price);
            const mine = record && c.offer.seller.toLowerCase() === record.owner.toLowerCase();
            return (
              <li key={c.offer.petId.toString()} className="adoption-card">
                <Little line={(["gentle", "bold", "curious"] as const)[c.offer.pet.line] ?? "gentle"} ageDays={age / 24} />
                <b>{p?.name ?? `#${c.offer.petId}`}</b>
                <span className="small">{L(`${age} hours old · pet #${c.offer.petId}`, `出生 ${age} 小时 · 宠物 #${c.offer.petId}`)}</span>
                {p?.family && <span className="small">{L(`child of ${p.family.parents[0].name} and ${p.family.parents[1].name}`, `${p.family.parents[0].name}和${p.family.parents[1].name}的孩子`)}</span>}
                <span className="adoption-price-tag">{formatBem(c.offer.price)} BEM</span>
                <span className="small">
                  {L(`${formatBem(s.burned)} burned · ${c.offer.coParent ? `${formatBem(s.share)} to ${short(c.offer.coParent)}` : "no co-parent share"} · from ${short(c.offer.seller)}`, `销毁 ${formatBem(s.burned)} · ${c.offer.coParent ? `${formatBem(s.share)} 给 ${short(c.offer.coParent)}` : "没有另一位父母的分成"} · 来自 ${short(c.offer.seller)}`)}
                </span>
                {c.problem === null ? (
                  <span className="small adoption-ok">{L("✓ Papers match X Layer", "✓ 资料与 X Layer 一致")}</span>
                ) : (
                  <span className="small sp-warn">{PROBLEM[c.problem][lang === "zh" ? 1 : 0]}</span>
                )}
                {!mine && c.problem === null && (
                  <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void adopt(c)}>
                    {busy === `adopt:${c.offer.petId}` ? L("Adopting…", "领养中……") : L("Adopt", "领养")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/** The breeder's view while a little one waits at the centre. */
export function CentreCard({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const petId = atCentre(pet);
  const [state, setState] = useState<"idle" | "checking" | "waiting" | "unreachable">(petId ? "checking" : "idle");
  const [busy, setBusy] = useState(false);
  const settled = useCallback((r: Awaited<ReturnType<typeof checkCentre>>) => {
    if (r === "adopted" || r === "back") play("success");
    else setState(r);
  }, []);
  const check = () => {
    setState("checking");
    return checkCentre(pet).then(settled);
  };
  // a little one newly at the centre is being checked from the moment the card shows it
  const [checkedFor, setCheckedFor] = useState(petId);
  if (petId !== checkedFor) {
    setCheckedFor(petId);
    if (petId) setState("checking");
  }
  // each check reads the pet as it is then, not as it was when the timer started
  const checkPet = useEffectEvent(() => checkCentre(pet));
  useEffect(() => {
    if (!petId) return;
    void checkPet().then(settled);
    const id = setInterval(() => {
      setState("checking");
      void checkPet().then(settled);
    }, 3 * 60_000);
    return () => clearInterval(id);
  }, [petId, settled]);
  if (!petId || !pet.away) return null;
  const until = new Date(pet.away.until).toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="away-card" role="status">
      <p className="label">{L("At the adoption centre", "在领养中心")}</p>
      <p>
        {L(
          `${pet.name} is waiting to be adopted until ${until}. It is paused while it waits. If nobody adopts it, it comes back to you.`,
          `${pet.name}在领养中心等待领养，直到 ${until}。等待期间它会暂停。如果没人领养，它会回到你身边。`,
        )}
      </p>
      {state === "waiting" && <p className="small">{L("Still waiting.", "还在等待。")}</p>}
      {state === "unreachable" && <p className="small">{L("X Layer couldn't be read just now; try again soon.", "暂时读不到 X Layer，稍后再试。")}</p>}
      <div className="row">
        <button type="button" className="btn primary" disabled={state === "checking"} onClick={() => (play("tap"), void check())}>
          {L("Check on it", "看看情况")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            play("tap");
            setBusy(true);
            try {
              await withdrawFromCentre(pet);
              play("success");
            } catch {
              play("error");
            }
            setBusy(false);
          }}
        >
          {busy ? L("Bringing it home…", "正在接回家……") : L("Bring it home", "接回家")}
        </button>
      </div>
    </div>
  );
}

/** Told once after a little one left for its new home: who went, and to whom. */
export function FarewellNote() {
  const lang = useLang((s) => s.lang) as Lang;
  const [notes, setNotes] = useState<Farewell[]>([]);
  useEffect(() => {
    const read = () => setNotes((n) => [...n, ...takeFarewells()]);
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, []);
  const f = notes[0];
  if (!f) return null;
  return (
    <div className="fam-modal" role="dialog" aria-label={lang === "zh" ? "去了新家" : "Gone to a new home"}>
      <div className="fam-card">
        <h3>{lang === "zh" ? `${f.name}去了新家` : `${f.name} has a new home`}</h3>
        <p>
          {lang === "zh"
            ? `${f.name}（宠物 #${f.petId}）在领养中心被 ${short(f.to)} 领养了。它带着自己的全部记忆去了新家，你的那份收入已经在钱包里。`
            : `${f.name} (pet #${f.petId}) was adopted at the centre by ${short(f.to)}. It took all its memories with it, and your share is already in your wallet.`}
        </p>
        <button type="button" className="btn primary" onClick={() => (play("tap"), setNotes((n) => n.slice(1)))}>
          {lang === "zh" ? "好的" : "OK"}
        </button>
      </div>
    </div>
  );
}
