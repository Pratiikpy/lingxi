/** The mailbox (PRD S7): letters, newest first, each opened in place; a gift is taken once. */

import { useEffect, useState } from "react";
import { ITEM } from "@lingxi/world";
import { useLang } from "../i18n";
import { allLetters, isUnread, useMail } from "../game/mail";
import { play } from "../game/sound";
import { CuteState } from "./CuteState";

export function MailboxPanel() {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const mail = useMail();
  const letters = allLetters(mail);
  const { loaded, failed, fetching, fetch: fetchMail } = mail;
  useEffect(() => {
    if (!loaded) void fetchMail();
  }, [loaded, fetchMail]);
  const again = () => {
    play("tap");
    void fetchMail();
  };
  // R36: an empty mailbox has the resident cat napping in it, and a mailbox still fetching has it looking up, as every
  // other empty or waiting list in the game does (a bare line read as something missing)
  if (!letters.length) {
    if (!loaded || fetching)
      return <CuteState who={{ cat: "look" }} busy text={L("Fetching the mail…", "正在取信……")} />;
    // R40: mail that could not be fetched is not an empty mailbox (a dropped connection read as "No letters yet."); it
    // is said as the game's other failed panels say it, with a way to fetch it again
    if (failed)
      return (
        <div className="panel-failed" role="alert">
          <CuteState
            who={{ cat: "sit1" }}
            text={L(
              "The mail couldn't be fetched just now. Nothing in it is lost.",
              "暂时取不到信。信都还在，不会丢。",
            )}
          />
          <button type="button" className="btn" onClick={again}>
            {L("Try again", "再试一次")}
          </button>
        </div>
      );
    return <CuteState who={{ cat: "nap" }} text={L("No letters yet.", "还没有信。")} />;
  }
  return (
    <>
      {/* the game's own letters are here, but Lingxi's could not be fetched: said above them, with the same way back */}
      {failed && !fetching && (
        <div className="mail-failed" role="status">
          <p className="small">
            {L("Some of Lingxi's letters couldn't be fetched just now.", "灵犀的一些来信暂时没取到。")}
          </p>
          <button type="button" className="btn" onClick={again}>
            {L("Try again", "再试一次")}
          </button>
        </div>
      )}
      <MailList />
    </>
  );
}

function MailList() {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const mail = useMail();
  const letters = allLetters(mail);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="mail-list">
      {letters.map((l) => {
        const open = openId === l.id;
        // the same rule as the count on the mail button: older news a newcomer finds is there, but not marked new
        const unread = isUnread(mail, l);
        const claimed = mail.claimed.includes(l.id);
        return (
          <li key={l.id} className={`mail-item${unread ? " is-unread" : ""}${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="mail-head"
              aria-expanded={open}
              onClick={() => {
                play("tap");
                mail.open(l.id);
                setOpenId(open ? null : l.id);
              }}
            >
              {unread && <i className="mail-dot" aria-label={L("unread", "未读")} />}
              <b>{l.subject[lang]}</b>
              <span className="small">
                {new Date(l.at).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" })}
                {l.local ? L(" · for you", " · 给你的") : ""}
                {l.gift && !claimed ? L(" · a gift inside", " · 附有礼物") : ""}
              </span>
            </button>
            {open && (
              <div className="mail-body">
                <p>{l.body[lang]}</p>
                {l.gift && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={claimed}
                    onClick={() => (play("success"), mail.claim(l.id))}
                  >
                    {claimed
                      ? L("Taken", "已领取")
                      : L(
                          `Take ${ITEM[l.gift.item]?.name.en ?? "the gift"} ×${l.gift.n}`,
                          `领取 ${ITEM[l.gift.item]?.name.zh ?? "礼物"} ×${l.gift.n}`,
                        )}
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
