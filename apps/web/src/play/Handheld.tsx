/**
 * The handheld on the Pet sheet (plan 4.14): pack snacks and take the pet along, its card while it is out, and the
 * return, which the game accepts only after replaying the whole trip itself.
 */

import { useEffect, useMemo, useState } from "react";
import type { Pet } from "@lingxi/game";
import { ITEM } from "@lingxi/world";
import { useLang } from "../i18n";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { type HomeResult, type TakeRefusal, MAX_SNACK_KINDS, MAX_SNACKS_EACH, RETURN_KEY, atHandheld, bringPetHome, callBack, pendingReturn, readTrip, takeAlong, travelFoods } from "../game/handheld";
import { CardputerProblem, cardputerAvailable, cardputerWords, fromCardputer, toCardputer } from "../game/cardputer";
import "./handheld.css";
import { saveRemove } from "../game/saveRuntime";

type Lang = "en" | "zh";
const HANDHELD_PAGE = "handheld.html";
/** asks HandheldReturn to check the packet the handheld sent back */
const HOMECOMING = "lingxi:handheld-home";
/** carries a result reached elsewhere (a Cardputer brought home) to HandheldReturn, which shows it */
const RESULT = "lingxi:handheld-result";

const TAKE_REFUSAL: Record<TakeRefusal, [string, string]> = {
  busy: ["It is already away, or another pet is out on the handheld.", "它已经出门了，或者另一只宠物正在掌机上。"],
  noSnacks: ["Those snacks are no longer in your bag.", "包里已经没有这些零食了。"],
  tooMany: [`Up to ${MAX_SNACK_KINDS} kinds, ${MAX_SNACKS_EACH} of each.`, `最多 ${MAX_SNACK_KINDS} 种，每种 ${MAX_SNACKS_EACH} 个。`],
  different: ["The handheld's circuit did not think exactly as your pet does, so it stays home. Nothing was taken.", "掌机上的电路和宠物的想法不完全一样，所以它留在家里。什么都没带走。"],
  unreachable: ["X Layer could not be read just now.", "暂时读不到 X Layer。"],
  device: ["The Cardputer did not take the pet, so it stays home. Nothing was taken.", "Cardputer 没有接收宠物，所以它留在家里。什么都没带走。"],
};

const HOME_REFUSAL: Record<Exclude<HomeResult, { ok: true }>["reason"], [string, string]> = {
  noTrip: ["No pet is out on the handheld.", "没有宠物在掌机上。"],
  notATrip: ["That is not a pet coming home from the handheld.", "这不是从掌机回来的宠物。"],
  damaged: ["The packet was damaged on the way. Send it again from the handheld.", "数据在路上坏了。请在掌机上再发一次。"],
  notThisTrip: ["That packet belongs to a different trip.", "这份数据属于另一次出门。"],
  badLog: ["The trip's log could not be read.", "旅程日志读不出来。"],
  noSnack: ["The log feeds a snack the pet never took along.", "日志里喂了一个没带出去的零食。"],
  aheadOfTime: ["The log runs ahead of the clock, which no real trip can.", "日志里的时间跑到了现在之前，真实的旅程不可能这样。"],
  differs: ["Replaying the trip did not arrive at the pet the handheld sent back, so it stays out.", "重放旅程得到的宠物和掌机送回来的不一样，所以它还在外面。"],
};

/** The Pet sheet's panel: pack snacks and send the pet to the handheld. */
export function HandheldPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const bag = useWorld((s) => s.world.bag);
  const foods = useMemo(() => travelFoods(bag), [bag]);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const out = readTrip();
  if (pet.away || pet.sitting) return null;

  const kinds = Object.values(picks).filter((n) => n > 0).length;
  const set = (item: number, n: number) => {
    play("tap");
    setPicks((p) => ({ ...p, [item]: n }));
  };
  const go = async (via: "browser" | "cardputer") => {
    setBusy(true);
    setNote(null);
    // the browser handheld opens now, in the same click, so no browser treats it as a pop-up
    const tab = via === "browser" ? window.open("about:blank", "lingxi-handheld") : null;
    const r = await takeAlong(pet, Object.entries(picks).map(([k, n]) => ({ item: Number(k), n })), lang, via === "cardputer" ? toCardputer : undefined);
    setBusy(false);
    if (!r.ok) {
      tab?.close();
      play("error");
      const why = r.reason === "device" && r.detail ? ` ${cardputerWords(r.detail, lang)}` : "";
      return setNote({ ok: false, text: TAKE_REFUSAL[r.reason][lang === "zh" ? 1 : 0] + why });
    }
    play("success");
    setPicks({});
    if (via === "cardputer") return;
    if (tab) tab.location.href = HANDHELD_PAGE;
    else location.href = HANDHELD_PAGE;
  };

  return (
    <div className="chainpanel handheld-panel">
      <p className="label">{L("Take along", "带出门")}</p>
      <p className="small">
        {L(
          `${pet.name} can go out on the handheld: the Cardputer's own firmware, here in your browser. It lives there on the same circuit it runs here, and you care for it with the keys. When it comes home the game replays every beat of the trip itself and keeps it only if it arrives at the very same pet.`,
          `${pet.name}可以跟着掌机出门：Cardputer 的固件，就在你的浏览器里。它在那里用和这里同一块电路生活，你用按键照顾它。回家时，游戏会自己把旅程的每一拍重放一遍，只有得到一模一样的宠物才让它回来。`,
        )}
      </p>
      {out && !atHandheld(pet) ? (
        <p className="small">{L("Another pet is out on the handheld. One at a time.", "另一只宠物正在掌机上。一次只能去一只。")}</p>
      ) : (
        <>
          <p className="small handheld-step">{L(`Pack snacks for the road (up to ${MAX_SNACK_KINDS} kinds):`, `带上路上吃的零食（最多 ${MAX_SNACK_KINDS} 种）：`)}</p>
          {foods.length === 0 ? (
            <p className="small">{L("No food in your bag. It can still go; the handheld just has nothing to feed it.", "包里没有食物。它也能出门，只是掌机上没东西喂它。")}</p>
          ) : (
            <ul className="handheld-snacks">
              {foods.map(({ item, n }) => {
                const def = ITEM[item]!;
                const chosen = picks[item] ?? 0;
                const most = Math.min(n, MAX_SNACKS_EACH);
                const full = chosen === 0 && kinds >= MAX_SNACK_KINDS;
                return (
                  <li key={item} className={chosen > 0 ? "on" : undefined}>
                    <img className="pixel" src={def.art} alt="" width={32} height={32} />
                    <span className="handheld-snack-name">
                      {def.name[lang]}
                      <span className="small">{L(`${n} in bag`, `包里 ${n} 个`)}</span>
                    </span>
                    <span className="handheld-stepper" role="group" aria-label={def.name[lang]}>
                      <button type="button" className="btn" disabled={chosen === 0} onClick={() => set(item, chosen - 1)} aria-label={L("one fewer", "少一个")}>
                        −
                      </button>
                      <output aria-live="polite">{chosen}</output>
                      <button type="button" className="btn" disabled={chosen >= most || full} onClick={() => set(item, chosen + 1)} aria-label={L("one more", "多一个")}>
                        +
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void go("browser")}>
              {busy ? L("Checking its circuit…", "正在核对电路……") : L("Take it along", "带它出门")}
            </button>
            {cardputerAvailable() && (
              <button type="button" className="btn" disabled={busy} onClick={() => void go("cardputer")}>
                {L("On a Cardputer (USB)", "放进 Cardputer（USB）")}
              </button>
            )}
          </div>
          <p className="small">{L("It is paused here while it is out. Snacks it does not eat come back to your bag.", "出门期间它在家里暂停。没吃完的零食会回到包里。")}</p>
        </>
      )}
      {note && (
        <p className={`small ${note.ok ? "" : "sp-warn"}`} role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}

/** The card shown in place of the room while the pet is out on the handheld. */
export function HandheldAwayCard({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [sure, setSure] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const trip = readTrip();
  const onCardputer = trip?.via === "cardputer";
  const fromDevice = async () => {
    setProblem(null);
    setLinking(true);
    try {
      const r = await fromCardputer();
      window.dispatchEvent(new CustomEvent<HomeResult>(RESULT, { detail: r }));
    } catch (e) {
      play("error");
      setProblem(e instanceof CardputerProblem ? cardputerWords(e.message, lang) : L(`The Cardputer stopped answering: ${String(e)}`, `Cardputer 不再回应：${String(e)}`));
    } finally {
      setLinking(false);
    }
  };
  const since = trip ? new Date(trip.sentAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const home = () => {
    const packet = pendingReturn();
    if (!packet) return setProblem(L("The handheld has not sent it home yet. Open the handheld and press Bring home.", "掌机还没有把它送回来。打开掌机，按“带回家”。"));
    setProblem(null);
    window.dispatchEvent(new Event(HOMECOMING));
  };
  return (
    <div className="away-card" role="status">
      <p className="label">{onCardputer ? L("Out on the Cardputer", "在 Cardputer 上") : L("Out on the handheld", "在掌机上")}</p>
      <p>
        {onCardputer
          ? L(
              `${pet.name} went out on the Cardputer ${since ? `on ${since}` : ""}. It is paused here; there it lives on, on its own circuit. Plug the Cardputer in to bring it home.`,
              `${pet.name}${since ? `在${since}` : ""}跟着 Cardputer 出门了。它在家里暂停；在 Cardputer 上，它用自己的电路继续生活。把 Cardputer 插上电脑就能带它回家。`,
            )
          : L(
              `${pet.name} went out on the handheld ${since ? `on ${since}` : ""}. It is paused here; on the handheld it lives on, on its own circuit.`,
              `${pet.name}${since ? `在${since}` : ""}跟着掌机出门了。它在家里暂停；在掌机上，它用自己的电路继续生活。`,
            )}
      </p>
      {trip && <p className="small">{trip.brain.source === "chain" ? L("Its brain on the handheld is the circuit read from X Layer.", "它在掌机上的大脑是从 X Layer 读来的电路。") : L("Its brain on the handheld is the game's own circuit, checked against it on every input.", "它在掌机上的大脑是游戏自己的电路，每一种输入都核对过。")}</p>}
      {problem && <p className="small sp-warn">{problem}</p>}
      {onCardputer ? (
        <div className="row">
          <button type="button" className="btn primary" disabled={linking || !cardputerAvailable()} onClick={() => (play("tap"), void fromDevice())}>
            {linking ? L("Replaying its trip…", "正在重放旅程……") : L("Bring it home from the Cardputer", "从 Cardputer 带它回家")}
          </button>
          {!cardputerAvailable() && <span className="small">{L("Use Chrome or Edge on a computer to reach the Cardputer.", "请在电脑上用 Chrome 或 Edge 连接 Cardputer。")}</span>}
        </div>
      ) : (
        <div className="row">
          <a className="btn primary" href={HANDHELD_PAGE} target="lingxi-handheld">
            {L("Open the handheld", "打开掌机")}
          </a>
          <button type="button" className="btn" onClick={() => (play("tap"), home())}>
            {L("It's back: check its trip", "它回来了：核对旅程")}
          </button>
        </div>
      )}
      {!sure ? (
        <button type="button" className="handheld-textbtn small" onClick={() => setSure(true)}>
          {L("Handheld lost? Call it back without its days there", "掌机丢了？不带那几天，直接叫它回来")}
        </button>
      ) : (
        <div className="row">
          <span className="small">{L("It comes back as it left, with all its snacks. Whatever happened on the handheld is gone.", "它会以出门时的样子回来，零食全部带回。掌机上发生的一切都不算了。")}</span>
          <button type="button" className="btn" onClick={() => (play("tap"), callBack())}>
            {L("Call it back", "叫它回来")}
          </button>
          <button type="button" className="btn" onClick={() => setSure(false)}>
            {L("Keep it out", "继续在外面")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Mounted with the game: a pet the handheld sent home is checked as soon as the game opens. */
export function HandheldReturn() {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [result, setResult] = useState<HomeResult | null>(null);
  useEffect(() => {
    const show = (r: HomeResult) => {
      play(r.ok ? "success" : "error");
      setResult(r);
    };
    const check = async () => {
      const packet = pendingReturn();
      if (!packet || !readTrip()) return;
      const r = await bringPetHome(packet);
      // a refused packet is not checked again on every visit; the handheld still holds the pet and can send it again
      if (!r.ok) saveRemove(RETURN_KEY);
      show(r);
      if (location.hash === "#handheld-home") history.replaceState(null, "", location.pathname + location.search);
    };
    void check();
    const onCheck = () => void check();
    const onStorage = (e: StorageEvent) => e.key === RETURN_KEY && e.newValue && onCheck();
    const onResult = (e: Event) => show((e as CustomEvent<HomeResult>).detail);
    window.addEventListener("storage", onStorage);
    window.addEventListener(HOMECOMING, onCheck);
    window.addEventListener(RESULT, onResult);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HOMECOMING, onCheck);
      window.removeEventListener(RESULT, onResult);
    };
  }, []);
  if (!result) return null;
  const m = result.ok ? result.minutes : 0;
  const span = (lang: Lang) => (m < 120 ? (lang === "zh" ? `${m} 分钟` : `${m} minute${m === 1 ? "" : "s"}`) : lang === "zh" ? `${Math.round(m / 6) / 10} 小时` : `${Math.round(m / 6) / 10} hours`);
  return (
    <div className="fam-modal" role="dialog" aria-label={L("Home from the handheld", "从掌机回来了")}>
      <div className="fam-card">
        {result.ok ? (
          <>
            <p className="label">{L("Home from the handheld", "从掌机回来了")}</p>
            <p>
              {L(
                `${m === 0 ? "It came straight back. " : `The game replayed every minute of its ${span("en")} out, `}${m === 0 ? "The game replayed" : "and"} its ${result.words} thoughts, and arrived at exactly the pet the handheld sent back.${result.cares ? ` Cared for ${result.cares} time${result.cares === 1 ? "" : "s"}; it all counts.` : ""}`,
                `${m === 0 ? "它一出门就回来了。游戏重放了" : `游戏重放了它在外面的 ${span("zh")}，每一分钟都没落下，还有`}它的 ${result.words} 个念头，得到的正是掌机送回来的宠物。${result.cares ? `照顾了 ${result.cares} 次，全部算数。` : ""}`,
              )}
            </p>
          </>
        ) : (
          <>
            <p className="label">{L("It stays out", "它还在外面")}</p>
            <p>{HOME_REFUSAL[result.reason][lang === "zh" ? 1 : 0]}</p>
          </>
        )}
        <button type="button" className="btn primary" onClick={() => (play("tap"), setResult(null))}>
          {L("OK", "好")}
        </button>
      </div>
    </div>
  );
}
