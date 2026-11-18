/**
 * What the player sees when the save rules step in (P1): the game is open in another tab; a save would not parse; a
 * write failed or storage is nearly full. Each says what happened and what to do, in both languages.
 */

import { useLayoutEffect, useState } from "react";
import { useLang } from "../i18n";
import type { Held } from "../game/save";
import { copyUsable, playHere, saves, useSaveState } from "../game/saveRuntime";
import "./save-screens.css";

const L = (lang: string, en: string, zh: string) => (lang === "zh" ? zh : en);

/** The parts of a save, as a player would name them. */
const PART: Record<string, [string, string]> = {
  "lingxi.pets.v2": ["your pets", "你的宠物"],
  "lingxi.world.v1": ["your world: bag, coins, home and quests", "你的世界：背包、金币、家和任务"],
  "lingxi.chain.v2": ["your pets' records on X Layer", "你的宠物在 X Layer 上的记录"],
  "lingxi.friends.v1": ["your friends", "你的朋友"],
  "lingxi.mail.v1": ["your letters", "你的信"],
  "lingxi.badges.v1": ["your badges", "你的徽章"],
  "lingxi.daily.v1": ["today's tasks", "今天的任务"],
};
const partName = (key: string, lang: string) => {
  const p = PART[key];
  return p ? L(lang, p[0], p[1]) : key.replace(/^lingxi\./, "");
};

/** This tab does not play: another has the game (or, for the handheld page, the handheld). */
export function ElsewhereScreen({ handheld = false, onHere = playHere }: { handheld?: boolean; onHere?: () => void }) {
  const { lang } = useLang();
  const title = handheld ? L(lang, "The handheld is open in another tab", "掌机在另一个标签页里开着") : L(lang, "Lingxi is open in another tab", "灵犀在另一个标签页里开着");
  const text = handheld
    ? L(lang, "The handheld runs in one tab at a time, so its memory is never written twice. Close the other tab, or move it here.", "掌机一次只在一个标签页里运行，这样它的记忆不会被写两次。关掉另一个标签页，或者把它挪到这里。")
    : L(
        lang,
        "Your pet plays in one tab at a time, so nothing you do is ever written twice or lost. Close the other tab, or move the game here.",
        "宠物一次只在一个标签页里玩，这样你做的事不会被写两次，也不会丢。关掉另一个标签页，或者把游戏挪到这里。",
      );
  return (
    <main className="save-screen" aria-labelledby="save-elsewhere-title">
      <section className="save-card">
        <h1 id="save-elsewhere-title">{title}</h1>
        <p>{text}</p>
        <button type="button" className="save-btn primary" onClick={onHere} autoFocus>
          {handheld ? L(lang, "Use it here", "在这里用") : L(lang, "Play here", "在这里玩")}
        </button>
      </section>
    </main>
  );
}

/** Shown over the game the moment another tab takes it over. */
export function ElsewhereOverlay() {
  const role = useSaveState((s) => s.role);
  if (role !== "elsewhere") return null;
  return (
    <div className="save-overlay" role="dialog" aria-modal="true">
      <ElsewhereScreen />
    </div>
  );
}

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Saves this page cannot use (one that will not parse, or one a newer Lingxi wrote) are set aside, and the player
 * chooses for each before the game loads. Nothing writes over them while this screen is up.
 */
export function RecoveryScreen({ damaged, onDone }: { damaged: Held[]; onDone: () => void }) {
  const { lang } = useLang();
  const [left, setLeft] = useState(damaged);
  const [note, setNote] = useState("");
  const settle = (key: string) => {
    const rest = left.filter((d) => d.key !== key);
    setLeft(rest);
    if (!rest.length) onDone();
  };
  const newer = left.some((d) => d.why === "newer");
  return (
    <main className="save-screen" aria-labelledby="save-recovery-title">
      <section className="save-card">
        <h1 id="save-recovery-title">{L(lang, "Part of your save could not be read", "有一部分存档读不出来")}</h1>
        <p>
          {L(
            lang,
            "Nothing has been written over it: it is kept exactly as it was. For each part, choose what to do.",
            "它没有被覆盖，原样保存着。请为每一部分选择怎么处理。",
          )}
        </p>
        {newer && (
          <p>
            {L(lang, "Part of it was saved by a newer Lingxi than this page. Reloading usually brings the newest version, which can read it.", "有一部分是比这个页面更新的灵犀保存的。刷新页面一般就会换到最新版本，它能读出来。")}
          </p>
        )}
        {newer && (
          <button type="button" className="save-btn primary save-reload" onClick={() => location.reload()}>
            {L(lang, "Reload for the newest version", "刷新，换到最新版本")}
          </button>
        )}
        <ul className="save-parts">
          {left.map(({ key, why }) => {
            const hasCopy = copyUsable(key);
            return (
              <li key={key}>
                <b>{partName(key, lang)}</b>
                <span className="small">{why === "newer" ? L(lang, " · saved by a newer Lingxi", " · 更新版本保存的") : L(lang, " · could not be read", " · 读不出来")}</span>
                <div className="save-row">
                  {hasCopy && (
                    <button
                      type="button"
                      className="save-btn primary"
                      onClick={() => {
                        if (saves.useCopy(key)) settle(key);
                        else setNote(L(lang, "The copy could not be put back. Try again.", "副本没能恢复，请再试一次。"));
                      }}
                    >
                      {L(lang, "Use the last good copy", "用上一个完好的副本")}
                    </button>
                  )}
                  <button type="button" className="save-btn" onClick={() => download(`lingxi-${key.replace(/^lingxi\./, "")}-as-saved.json`, saves.read(key) ?? saves.read(`${key}~damaged`) ?? "")}>
                    {L(lang, "Download it as it is", "原样下载")}
                  </button>
                  <button
                    type="button"
                    className="save-btn"
                    onClick={() => {
                      if (saves.startFresh(key)) settle(key);
                    }}
                  >
                    {L(lang, "Start this part afresh", "这一部分重新开始")}
                  </button>
                </div>
                {!hasCopy && <p className="small">{L(lang, "There is no earlier copy of this part. Download it first if you want to keep it.", "这一部分没有更早的副本。想留着的话，请先下载。")}</p>}
              </li>
            );
          })}
        </ul>
        {note && (
          <p className="small" role="alert">
            {note}
          </p>
        )}
      </section>
    </main>
  );
}

/** How far above the bottom of the screen the tab bar's top is, when the bar sits at the bottom; 0 otherwise. */
function tabBarLift(): number {
  const r = document.querySelector(".tabs")?.getBoundingClientRect();
  if (!r || r.height === 0) return 0;
  return r.top < innerHeight && r.bottom > innerHeight - 160 ? Math.max(0, innerHeight - r.top) : 0;
}

/** In the game: a write failed, or storage is nearly full. It sits above the tab bar, never over it. */
export function SaveBanner({ onSaveFile }: { onSaveFile?: () => void }) {
  const { lang } = useLang();
  const failed = useSaveState((s) => s.failed);
  const nearlyFull = useSaveState((s) => s.nearlyFull);
  const [closedFailure, setClosedFailure] = useState<number | null>(null);
  const [closedWarning, setClosedWarning] = useState(false);
  const [lift, setLift] = useState(0);
  const showing = (!!failed && closedFailure !== failed.at) || (!failed && nearlyFull && !closedWarning);
  useLayoutEffect(() => {
    if (!showing) return;
    const place = () => setLift(tabBarLift());
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [showing]);
  if (!showing) return null;
  const text = failed
    ? failed.reason === "full"
      ? L(lang, "Lingxi couldn't save: this browser's storage is full. Download your save file to keep everything safe.", "灵犀没能保存：这个浏览器的存储空间满了。请下载存档文件，把一切保存好。")
      : L(lang, "Lingxi couldn't save: this browser is not letting it store anything. Download your save file to keep everything safe.", "灵犀没能保存：这个浏览器不允许存储。请下载存档文件，把一切保存好。")
    : L(lang, "This browser's storage for Lingxi is nearly full. Download your save file to keep a copy.", "这个浏览器给灵犀的存储空间快满了。请下载存档文件留一份。");
  const close = () => (failed ? setClosedFailure(failed.at) : setClosedWarning(true));
  return (
    <div className={`save-banner${failed ? " bad" : ""}`} role={failed ? "alert" : "status"} style={lift ? { bottom: lift + 8 } : undefined}>
      <span>{text}</span>
      {onSaveFile && (
        <button type="button" className="save-btn primary" onClick={onSaveFile}>
          {L(lang, "Save file", "存档文件")}
        </button>
      )}
      <button type="button" className="save-btn save-close" onClick={close} aria-label={L(lang, "Close", "关闭")}>
        ✕
      </button>
    </div>
  );
}
