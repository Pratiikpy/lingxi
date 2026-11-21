/**
 * Pet letters (H13): a pet writes to a friend's pet over TapeRelay. Write to a friend whose address came with your
 * friendship, see where each letter stands, read letters from friends (each sealed and signed, checked on arrival),
 * accept or ignore a stranger's first letter, and read plainly what TapeRelay is and keeps. Letter text is shown only as
 * text.
 */

import { useEffect, useMemo, useState } from "react";
import { PET_LETTER_MAX } from "@lingxi/game";
import { useLang } from "../i18n";
import { type KeptLetter, type LettersTrouble, useLetters, writableFriends } from "../game/letters";
import { bondsOf, useFriends } from "../game/friends";
import { useGame } from "../game/store";
import { playerId } from "../game/live";
import { play } from "../game/sound";

const chars = (s: string) => [...s].length;

export function PetLetters() {
  const lang = useLang((s) => s.lang) === "zh" ? "zh" : "en";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const pet = useGame((s) => s.pet);
  const all = useFriends((s) => s.all);
  const { saved, trouble, ensure, send, retry, pull, accept, ignore } = useLetters();
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // opening letters is the first time they are needed: the identity is made now, and the inbox read
  useEffect(() => {
    void ensure().then(() => pull());
  }, [ensure, pull]);
  const friends = useMemo(() => (pet ? writableFriends(bondsOf(all, pet.bornAt), saved?.book ?? {}) : []), [pet, all, saved]);
  const chosen = friends.find((f) => `${f.player}:${f.pet}` === to) ?? friends[0];
  if (!pet) return null;

  const troubleText = (t: LettersTrouble | "empty" | "tooLong" | "noAddress") =>
    ({
      down: L("TapeRelay could not be reached. Your letters are safe here; try again in a moment.", "暂时连不上 TapeRelay。你的信都还存在这里，过一会儿再试。"),
      noKey: L("That friend's letters address is not ready yet: they need to open their letters once.", "这位朋友的收信地址还没准备好：要等对方打开一次宠物的信。"),
      tooFast: L("That was quick: wait a moment before the next letter.", "写得太快了，等一会儿再寄下一封。"),
      refused: L("TapeRelay did not take the letter. Try again in a moment.", "TapeRelay 没有收下这封信，过一会儿再试。"),
      empty: L("Write something first.", "先写点什么吧。"),
      tooLong: L(`A letter is at most ${PET_LETTER_MAX} characters.`, `一封信最多 ${PET_LETTER_MAX} 个字。`),
      noAddress: L("That friend's letters address has not reached you yet: meet in a live room once.", "还没拿到这位朋友的收信地址：在同一个房间里见一面就有了。"),
    })[t];

  const submit = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    setNote(null);
    const r = await send(chosen, pet.name, playerId(), text);
    setBusy(false);
    if (r.ok) {
      play("success");
      setText("");
      setNote({ ok: true, text: L(`Sent to ${chosen.pet}.`, `已寄给${chosen.pet}。`) });
    } else {
      play("error");
      setNote({ ok: false, text: troubleText(r.reason) });
    }
  };

  const mine = (saved?.kept ?? []).filter((k) => k.myPet === pet.name || k.dir === "out");
  return (
    <section className="pet-letters" aria-label={L("Pet letters", "宠物的信")}>
      <p className="small pl-about">
        {L(
          "Letters travel over TapeRelay, the TapeOut team's relay, free during its test. Each letter is sealed and signed on this device. The relay keeps a letter at most 30 days; the letters you get are kept on this device and in your save file, not on chain.",
          "信通过 TapeRelay（TapeOut 团队的中转）寄送，测试期间免费。每封信都在这台设备上封好、签名。中转最多保留一封信 30 天；你收到的信存在这台设备和存档文件里，不在链上。",
        )}
      </p>

      {trouble === "down" && (
        <div className="pl-down" role="status">
          <span>{troubleText("down")}</span>
          <button type="button" className="btn" onClick={() => (play("tap"), void ensure().then(() => pull()))}>
            {L("Try again", "重试")}
          </button>
        </div>
      )}

      {friends.length ? (
        <form
          className="pl-write"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="small">
            {L(`${pet.name} writes to`, `${pet.name}写给`)}{" "}
            <select value={chosen ? `${chosen.player}:${chosen.pet}` : ""} onChange={(e) => setTo(e.target.value)}>
              {friends.map((f) => (
                <option key={`${f.player}:${f.pet}`} value={`${f.player}:${f.pet}`}>
                  {f.pet}
                </option>
              ))}
            </select>
          </label>
          <textarea
            value={text}
            rows={4}
            onChange={(e) => setText(e.target.value)}
            aria-label={L("Your letter", "你的信")}
            placeholder={L("Dear friend…", "亲爱的朋友……")}
          />
          <div className="row pl-send">
            <span className={`small${chars(text.trim()) > PET_LETTER_MAX ? " warn" : ""}`}>
              {chars(text.trim())}/{PET_LETTER_MAX}
            </span>
            <button type="submit" className="btn primary" disabled={busy || !text.trim() || chars(text.trim()) > PET_LETTER_MAX}>
              {busy ? L("Sending…", "正在寄……") : L("Send the letter", "寄出")}
            </button>
          </div>
          {note && (
            <p className={`small ${note.ok ? "pl-ok" : "err"}`} role={note.ok ? "status" : "alert"}>
              {note.text}
            </p>
          )}
        </form>
      ) : (
        <p className="small">
          {L(
            `${pet.name} can write to its friends. A friend's letters address comes with your friendship: meet their pet in a live room, and it is here.`,
            `${pet.name}可以给朋友写信。朋友的收信地址跟着友谊一起来：在同一个房间里见到对方的宠物，就会出现在这里。`,
          )}
        </p>
      )}

      {(saved?.strangers ?? []).length > 0 && (
        <div className="pl-strangers">
          <p className="label">{L("Wants to write to you", "想给你写信")}</p>
          {saved!.strangers.map((s) => (
            <div key={s.address} className="pl-letter is-in">
              <p className="small">{L(`${s.pet} (not a friend yet) wrote:`, `${s.pet}（还不是朋友）写来：`)}</p>
              <p className="pl-text">{s.text}</p>
              <div className="row">
                <button type="button" className="btn" onClick={() => (play("tap"), void accept(s.address))}>
                  {L("Accept their letters", "接收对方的信")}
                </button>
                <button type="button" className="btn" onClick={() => (play("tap"), void ignore(s.address))}>
                  {L("Ignore", "不理")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ul className="pl-list">
        {mine.map((l) => (
          <LetterRow key={l.id} l={l} lang={lang} onRetry={() => (play("tap"), void retry(l.id, playerId()))} />
        ))}
      </ul>
    </section>
  );
}

function LetterRow({ l, lang, onRetry }: { l: KeptLetter; lang: "en" | "zh"; onRetry: () => void }) {
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const when = new Date(l.at).toLocaleString(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const state = l.state === "sending" ? L("sending…", "正在寄……") : l.state === "waiting" ? L("on its way", "在路上") : l.state === "delivered" ? L("delivered", "已送到") : l.state === "failed" ? L("not delivered", "没送到") : "";
  return (
    <li className={`pl-letter ${l.dir === "in" ? "is-in" : "is-out"}`}>
      <p className="small">
        {l.dir === "in" ? L(`From ${l.pet} to ${l.myPet}`, `${l.pet}写给${l.myPet}`) : L(`${l.myPet} to ${l.pet}`, `${l.myPet}写给${l.pet}`)} · {when}
        {l.dir === "out" && state ? ` · ${state}` : ""}
      </p>
      <p className="pl-text">{l.text}</p>
      {l.dir === "in" && <p className="small pl-checked">{L("Sealed and signed, checked on arrival", "已封好并签名，收到时核对过")}</p>}
      {l.dir === "out" && l.state === "failed" && (
        <button type="button" className="btn" onClick={onRetry}>
          {L("Try again", "再寄一次")}
        </button>
      )}
    </li>
  );
}
