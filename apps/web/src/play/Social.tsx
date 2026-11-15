/** Saying hello to the pets around you, and inviting friends home. */

import { useState } from "react";
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

export function SocialBar({ count }: { count: number }) {
  const { lang } = useLang();
  const emote = useLive((s) => s.emote);
  const say = useLive((s) => s.say);
  const [text, setText] = useState("");
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
      <em>{lang === "zh" ? `${count} 位朋友在这里` : `${count} here`}</em>
      {EMOTES.map(([kind, icon, label]) => (
        <button key={kind} type="button" className="emote" aria-label={label} onClick={() => (emote(kind), play("pop"))}>
          <Icon name={icon} size={16} />
        </button>
      ))}
      <input value={text} maxLength={60} onChange={(e) => setText(e.target.value)} placeholder={lang === "zh" ? "打个招呼……" : "Say hi..."} aria-label={lang === "zh" ? "说点什么" : "Say something"} />
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
      <p className="small">{lang === "zh" ? "把这个链接发给朋友，他们的宠物就能来你家玩。你在家的时候，大家会实时看到彼此。" : "Send this link to a friend and their pet can come over. When you're both home, you'll see each other live."}</p>
      <div className="row">
        <input className="invite" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={lang === "zh" ? "邀请链接" : "Invite link"} />
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
