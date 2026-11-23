/**
 * The save file (P1 S5): download the whole game, keys included, locked with a passphrase; restore it in this or
 * another browser. A file is opened and checked, and its pets shown, before it replaces anything; a restore can be
 * undone right after, and a device key it replaces is kept (move.ts).
 */

import { useState } from "react";
import { useLang } from "../i18n";
import { restoreFrom } from "../game/move";
import { READERS, useSaveState } from "../game/saveRuntime";
import { MIN_PASSPHRASE, type SaveContents, makePassphrase, openSave, passphraseProblem, saveKeysOf, sealSave, summarise } from "../game/saveFile";
import { inTelegram } from "../game/telegram";
import { play } from "../game/sound";
import { Sheet } from "./Sheets";
import "./savefile.css";
import { now } from "../game/gameClock";

/** A save file larger than this is not one of ours (a full browser storage locked and encoded is far smaller). */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export { useSaveFileUi } from "./saveFileUi";
import { useSaveFileUi } from "./saveFileUi";

type Lang = "en" | "zh";
const L = (lang: Lang, en: string, zh: string) => (lang === "zh" ? zh : en);
const when = (at: number, lang: Lang) => new Date(at).toLocaleString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Make a save file. */
function MakeFile({ lang }: { lang: Lang }) {
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [shown, setShown] = useState(false);
  const [made, setMade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const short = passphraseProblem(pass) === "short";
  const differ = again !== pass;
  const ready = !short && !differ && !busy;
  const make = () => {
    const p = makePassphrase();
    setPass(p);
    setAgain(p);
    setShown(true);
    setMade(true);
    setNote(null);
    play("tap");
  };
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const keys = saveKeysOf(localStorage);
      const file = await sealSave({ savedAt: now(), keys }, pass);
      const name = `lingxi-save-${day(now())}.json`;
      download(name, file);
      play("success");
      setNote({ ok: true, text: L(lang, `Saved as ${name}. Keep it, and its passphrase, somewhere safe.`, `已保存为 ${name}。请把它和密码一起放在安全的地方。`) });
    } catch {
      play("error");
      setNote({ ok: false, text: L(lang, "The file couldn't be made in this browser. Try again, or in another browser.", "这个浏览器没能做出存档文件。请再试一次，或换一个浏览器。") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sf-part" aria-labelledby="sf-make">
      <h3 id="sf-make">{L(lang, "Download your save file", "下载存档文件")}</h3>
      <p>
        {L(
          lang,
          "One file with everything: your pets, your world, your letters, and the keys that save your pets on X Layer. It is locked with a passphrase you choose. Nobody can open it without the passphrase, and nobody can recover a lost one, not even us.",
          "一个文件装下一切：你的宠物、你的世界、你的信，还有把宠物保存到 X Layer 的密钥。它用你选的密码锁住。没有密码谁也打不开，密码丢了也没人能找回，我们也不能。",
        )}
      </p>
      <label className="sf-field">
        <span>{L(lang, `Passphrase (at least ${MIN_PASSPHRASE} characters)`, `密码（至少 ${MIN_PASSPHRASE} 个字符）`)}</span>
        <input type={shown ? "text" : "password"} value={pass} autoComplete="new-password" spellCheck={false} onChange={(e) => (setPass(e.target.value), setMade(false))} />
      </label>
      <label className="sf-field">
        <span>{L(lang, "The same passphrase again", "再输入一次")}</span>
        <input type={shown ? "text" : "password"} value={again} autoComplete="new-password" spellCheck={false} onChange={(e) => (setAgain(e.target.value), setMade(false))} />
      </label>
      <div className="sf-row">
        <button type="button" className="btn small-btn" onClick={make}>
          {L(lang, "Make a strong one for me", "帮我生成一个强密码")}
        </button>
        <button type="button" className="btn small-btn" onClick={() => setShown(!shown)} aria-pressed={shown}>
          {shown ? L(lang, "Hide", "隐藏") : L(lang, "Show", "显示")}
        </button>
      </div>
      {made && <p className="sf-warn">{L(lang, "Write this passphrase down, or keep it in your password manager. Without it the file cannot be opened.", "请把这个密码写下来，或存进密码管理器。没有它，文件就打不开。")}</p>}
      {pass && short && <p className="small">{L(lang, `${MIN_PASSPHRASE - [...pass.normalize("NFKC").trim()].length} more characters to go.`, `还差 ${MIN_PASSPHRASE - [...pass.normalize("NFKC").trim()].length} 个字符。`)}</p>}
      {!short && again && differ && <p className="small">{L(lang, "The two passphrases are not the same yet.", "两次输入的密码还不一样。")}</p>}
      <button type="button" className="btn primary" disabled={!ready} onClick={() => void save()}>
        {busy ? L(lang, "Locking…", "正在加锁……") : L(lang, "Download save file", "下载存档文件")}
      </button>
      {note && (
        <p className={note.ok ? "sf-ok" : "sf-bad"} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      )}
    </section>
  );
}

const PROBLEM: Record<"notASave" | "newer" | "locked" | "damaged" | "tooBig" | "full", [string, string]> = {
  notASave: ["This isn't a Lingxi save file.", "这不是灵犀的存档文件。"],
  newer: ["This file was made by a newer Lingxi. Reload the page for the newest version, then open it again.", "这个文件是更新版本的灵犀做的。请刷新页面换到最新版本，再打开它。"],
  locked: ["That passphrase doesn't open this file. Check it and try again.", "这个密码打不开这个文件。请检查后再试。"],
  damaged: ["The file opened, but what is inside is damaged. Nothing was changed.", "文件打开了，但里面的内容损坏了。什么都没有改动。"],
  tooBig: ["This file is far larger than a save file can be.", "这个文件比存档文件大得多，不是存档文件。"],
  full: ["This browser has no room to restore it. Nothing was changed.", "这个浏览器没有空间恢复它。什么都没有改动。"],
};

/** Open a save file and, once the player has seen what it holds, restore it. */
function OpenFile({ lang, here }: { lang: Lang; here: string[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<keyof typeof PROBLEM | null>(null);
  const [opened, setOpened] = useState<SaveContents | null>(null);
  const open = async () => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      if (file.size > MAX_FILE_BYTES) return setProblem("tooBig");
      const r = await openSave(await file.text(), pass);
      if (!r.ok) return setProblem(r.reason);
      // the same readers the game uses at start: a part this page cannot read is never restored over a good one
      const verdicts = Object.entries(r.contents.keys).map(([k, v]) => {
        const reader = READERS[k];
        if (!reader) return "ok";
        try {
          return reader(JSON.parse(v));
        } catch {
          return "unreadable";
        }
      });
      if (verdicts.includes("newer")) return setProblem("newer");
      if (verdicts.includes("unreadable")) return setProblem("damaged");
      setOpened(r.contents);
      play("success");
    } catch {
      setProblem("damaged");
    } finally {
      setBusy(false);
    }
  };
  if (opened) {
    const s = summarise(opened);
    const names = s.pets.join(lang === "zh" ? "、" : ", ");
    return (
      <section className="sf-part" aria-labelledby="sf-check">
        <h3 id="sf-check">{L(lang, "Check before restoring", "恢复之前先看一看")}</h3>
        <dl className="sf-sum">
          <dt>{L(lang, "This file holds", "这个文件里有")}</dt>
          <dd>
            {s.pets.length ? L(lang, `${s.pets.length === 1 ? "1 pet" : `${s.pets.length} pets`}: ${names}`, `${s.pets.length} 只宠物：${names}`) : L(lang, "no pets", "没有宠物")}
            {s.hasKeys ? L(lang, ", and the keys that save them", "，还有保存它们的密钥") : ""}
          </dd>
          <dt>{L(lang, "Saved", "保存时间")}</dt>
          <dd>{when(s.savedAt, lang)}</dd>
          <dt>{L(lang, "This browser has now", "这个浏览器现在有")}</dt>
          <dd>{here.length ? here.join(lang === "zh" ? "、" : ", ") : L(lang, "no pets", "没有宠物")}</dd>
        </dl>
        <p>{L(lang, "Restoring puts the file's game in place of this browser's. You can undo it right after, and no key this browser holds is ever thrown away.", "恢复会用文件里的游戏替换这个浏览器里的。恢复后可以马上撤销，这个浏览器里的密钥也一个都不会丢。")}</p>
        {s.hasKeys && (
          <p className="sf-warn">
            {L(lang, "Only restore a file you made yourself. It brings its own keys, so a file from someone else would let them act for your pets.", "只恢复你自己做的文件。文件带着它自己的密钥，别人给的文件会让对方能替你的宠物做事。")}
          </p>
        )}
        <div className="sf-row">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              play("tap");
              if (!restoreFrom(opened.keys)) setProblem("full");
            }}
          >
            {L(lang, "Restore", "恢复")}
          </button>
          <button type="button" className="btn" onClick={() => setOpened(null)}>
            {L(lang, "Cancel", "取消")}
          </button>
        </div>
        {problem && (
          <p className="sf-bad" role="alert">
            {L(lang, ...PROBLEM[problem])}
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="sf-part" aria-labelledby="sf-open">
      <h3 id="sf-open">{L(lang, "Restore from a save file", "从存档文件恢复")}</h3>
      <div className="sf-field">
        <span id="sf-file-label">{L(lang, "Save file", "存档文件")}</span>
        <div className="sf-pick">
          <label className="btn small-btn">
            {file ? L(lang, "Choose another", "换一个文件") : L(lang, "Choose file", "选择文件")}
            <input className="sf-file-input" type="file" accept=".json,application/json" aria-labelledby="sf-file-label" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setProblem(null))} />
          </label>
          <span className="sf-file-name">{file ? file.name : L(lang, "No file chosen yet", "还没有选择文件")}</span>
        </div>
      </div>
      <label className="sf-field">
        <span>{L(lang, "Its passphrase", "它的密码")}</span>
        <input type="password" value={pass} autoComplete="current-password" spellCheck={false} onChange={(e) => (setPass(e.target.value), setProblem(null))} />
      </label>
      <button type="button" className="btn primary" disabled={!file || !pass || busy} onClick={() => void open()}>
        {busy ? L(lang, "Opening…", "正在打开……") : L(lang, "Open file", "打开文件")}
      </button>
      {problem && (
        <p className="sf-bad" role="alert">
          {L(lang, ...PROBLEM[problem])}
        </p>
      )}
    </section>
  );
}

/** The save file sheet: making one, and restoring one. `here` names this browser's pets for the comparison. */
export function SaveFileSheet({ here }: { here: string[] }) {
  const lang = useLang((s) => s.lang) as Lang;
  const { open, hide } = useSaveFileUi();
  const writer = useSaveState((s) => s.role) === "writer";
  return (
    <Sheet open={open} title={L(lang, "Save file", "存档文件")} onClose={hide}>
      {open && (
        <div className="sf">
          {inTelegram() ? (
            writer && (
              <>
                {/* Telegram's webview cannot save a file a page makes, so files are made in a browser; one opens here */}
                <p className="sf-warn">{L(lang, "Save files are made in a browser. A file made there can be restored here.", "存档文件要在浏览器里制作。在那里做好的文件，可以在这里恢复。")}</p>
                <OpenFile lang={lang} here={here} />
              </>
            )
          ) : writer ? (
            <>
              {/* a browser with no pets yet has nothing worth a file: it is here to restore one */}
              {here.length > 0 && (
                <>
                  <MakeFile lang={lang} />
                  <hr className="divider" />
                </>
              )}
              <OpenFile lang={lang} here={here} />
            </>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

/** At the top of the pet's page: what a save file is, and the way in. */
export function SaveFileCard() {
  const lang = useLang((s) => s.lang) as Lang;
  return (
    <section className="sf-card" aria-labelledby="sf-card-h">
      <div>
        <h3 id="sf-card-h">{L(lang, "Save file", "存档文件")}</h3>
        <p className="small">{L(lang, "Keep everything in one locked file, or bring a save back.", "把一切存进一个加锁的文件，或者把存档找回来。")}</p>
      </div>
      <button type="button" className="btn" onClick={() => (play("tap"), useSaveFileUi.getState().show())}>
        {L(lang, "Open", "打开")}
      </button>
    </section>
  );
}
