/** The mailbox (PRD S7): letters, newest first, each opened in place; a gift is taken once. */

import { useEffect, useState } from "react";
import { ITEM } from "@lingxi/world";
import { useLang } from "../i18n";
import { allLetters, isUnread, useMail } from "../game/mail";
import { play } from "../game/sound";

export function MailboxPanel() {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const mail = useMail();
  const letters = allLetters(mail);
  const [openId, setOpenId] = useState<string | null>(null);
  const { loaded, fetch: fetchMail } = mail;
  useEffect(() => {
    if (!loaded) void fetchMail();
  }, [loaded, fetchMail]);
  if (!letters.length)
    return (
      <p className="small">
        {mail.loaded ? L("No letters yet.", "还没有信。") : L("Fetching the mail…", "正在取信……")}
      </p>
    );
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
