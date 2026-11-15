/** The active pet's friends (PRD M7): closest first, with the level and how far to the next. */

import { useMemo } from "react";
import { boundingBox, drawPet } from "@lingxi/art";
import { BOND_LEVELS, FAMILY_BOND_LEVEL, type Pet, bondLevel, bondProgress, friendsByCloseness } from "@lingxi/game";
import { useLang } from "../i18n";
import { bondName, bondsOf, useFriends } from "../game/friends";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";

const LINES = ["gentle", "bold", "curious"] as const;
const lineOf = (l: string) => (LINES as readonly string[]).includes(l) ? (l as (typeof LINES)[number]) : "gentle";

function FriendFace({ line }: { line: string }) {
  const { canvas, crop } = useMemo(() => {
    const c = drawPet(lineOf(line), "child", { expression: "happy" });
    const b = boundingBox(c);
    return { canvas: c, crop: { x: Math.max(0, b.x - 1), y: Math.max(0, b.y - 1), w: Math.min(c.w, b.w + 2), h: Math.min(c.h, b.h + 2) } };
  }, [line]);
  return <Sprite canvas={canvas} palette={PALETTE_OF[lineOf(line)]} scale={2} crop={crop} />;
}

export function FriendsPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const all = useFriends((s) => s.all);
  const friends = friendsByCloseness(bondsOf(all, pet.bornAt));
  return (
    <div className="chainpanel friends">
      <p className="label">{L(`${pet.name}'s friends`, `${pet.name}的朋友`)}</p>
      <p className="small">
        {L(
          `Time together in a room, hearts, waves, spars and stays bring pets closer, a little each day. Pets raise a little one together only once they are ${bondName(FAMILY_BOND_LEVEL, "en").toLowerCase()}.`,
          `在同一个房间里待着、送心、挥手、切磋、去朋友家住，每天都会让宠物更亲近一点。成为${bondName(FAMILY_BOND_LEVEL, "zh")}之后，才能一起养小宝宝。`,
        )}
      </p>
      {friends.length === 0 ? (
        <p className="small">{L("No friends yet. Visit a room with other pets, or send a friend your invite link.", "还没有朋友。去有其他宠物的房间看看，或者把邀请链接发给朋友。")}</p>
      ) : (
        <ul className="friend-list">
          {friends.map(([id, b]) => {
            const level = bondLevel(b.points);
            const next = BOND_LEVELS[level + 1];
            return (
              <li key={id} className={`friend level-${level}`}>
                <FriendFace line={b.line} />
                <div className="friend-text">
                  <b>{b.name}</b>
                  <span className="small">
                    {bondName(level, lang)}
                    {level >= FAMILY_BOND_LEVEL ? L(" · can raise a little one", " · 可以一起养小宝宝") : ""}
                  </span>
                  <span className="friend-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bondProgress(b.points) * 100)} aria-label={next ? L(`${next - b.points} to ${bondName(level + 1, "en")}`, `离${bondName(level + 1, "zh")}还差 ${next - b.points}`) : bondName(level, lang)}>
                    <i style={{ width: `${Math.round(bondProgress(b.points) * 100)}%` }} />
                  </span>
                </div>
                <span className="small friend-seen">{new Date(b.last).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" })}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
