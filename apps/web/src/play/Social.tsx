/** Saying hello to the pets around you, and inviting friends home. */

import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n";
import { liveAvailable, playerId, useLive } from "../game/live";
import { play } from "../game/sound";
import { Icon, type IconName } from "./icons";

const EMOTES: Array<[string, IconName, string]> = [
  ["wave", "hand", "wave"],
  ["heart", "heart", "heart"],
  ["laugh", "note", "laugh"],
  ["dance", "star", "dance"],
];

/** Someone in the room whose card can be opened. */
export interface HereOne {
  id: string;
  name: string;
}

/**
 * The room's bar: who is here, a wave or a heart for everyone, and a line to say. The count opens a list of who is
 * here, each name opening that pet's card: the way to a visitor however crowded or narrow the room is, and the only one
 * for a keyboard or a screen reader, which cannot tap the room's picture (A69).
 */
export function SocialBar({ here, onPick }: { here: HereOne[]; onPick: (id: string) => void }) {
  const { lang } = useLang();
  const emote = useLive((s) => s.emote);
  const say = useLive((s) => s.say);
  const [text, setText] = useState("");
  const [asked, setOpen] = useState(false);
  // nobody left to list: the list is shut with them
  const open = asked && here.length > 0;
  const list = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>(".here-one")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      opener.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const title = lang === "zh" ? "谁在这里" : "Who's here";
  return (
    <form
      className="social"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        say(text.trim());
        setText("");
        play("tap");
      }}
    >
      <button
        ref={opener}
        type="button"
        className="here"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (play("tap"), setOpen(!open))}
      >
        {lang === "zh" ? `${here.length} 位朋友在这里` : `${here.length} here`}
      </button>
      {open && (
        <div ref={list} className="here-list" role="dialog" aria-label={title}>
          <b>{title}</b>
          <button
            type="button"
            className="icon-x"
            aria-label={lang === "zh" ? "关闭" : "Close"}
            onClick={() => (setOpen(false), opener.current?.focus())}
          >
            <Icon name="close" size={14} />
          </button>
          <ul>
            {here.map((h) => (
              <li key={h.id}>
                <button type="button" className="here-one" onClick={() => (play("tap"), setOpen(false), onPick(h.id))}>
                  {h.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {EMOTES.map(([kind, icon, label]) => (
        <button
          key={kind}
          type="button"
          className="emote"
          aria-label={label}
          onClick={() => (emote(kind), play("pop"))}
        >
          <Icon name={icon} size={16} />
        </button>
      ))}
      <input
        value={text}
        maxLength={60}
        onChange={(e) => setText(e.target.value)}
        placeholder={lang === "zh" ? "打个招呼……" : "Say hi..."}
        aria-label={lang === "zh" ? "说点什么" : "Say something"}
      />
    </form>
  );
}

export function InvitePanel() {
  const { lang } = useLang();
  const [copied, setCopied] = useState(false);
  if (!liveAvailable()) return null;
  const link = `${location.origin}${location.pathname}?visit=${playerId()}`;
  return (
    <div className="chainpanel">
      <p className="label">{lang === "zh" ? "朋友" : "Friends"}</p>
      <p className="small">
        {lang === "zh"
          ? "把这个链接发给朋友，他们的宠物就能来你家玩。你在家的时候，大家会实时看到彼此。"
          : "Send this link to a friend and their pet can come over. When you're both home, you'll see each other live."}
      </p>
      <div className="row">
        <input
          className="invite"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={lang === "zh" ? "邀请链接" : "Invite link"}
        />
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              play("success");
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? (lang === "zh" ? "已复制" : "Copied") : lang === "zh" ? "复制链接" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
