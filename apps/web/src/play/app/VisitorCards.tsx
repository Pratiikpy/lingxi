/**
 * P7: the cards for the visitors in the room, out of PlayApp: the shy one in the night forest, the player's own other
 * pets dropping by, and another player's pet, with a heart, a spar and a family ask.
 */
import type { Pet } from "@lingxi/game";
import { bondLevel } from "@lingxi/game";
import { useChain } from "../../game/chain";
import { bondBlock, familyBlock } from "../../game/familyRules";
import { bondName, bondsOf, friendKey, useFriends } from "../../game/friends";
import { now } from "../../game/gameClock";
import { useLive } from "../../game/live";
import { play } from "../../game/sound";
import { useGame } from "../../game/store";
import { Icon } from "../icons";
import { useWorldMessage } from "./worldMessage";

interface VisitorCardsProps {
  pet: Pet;
  lang: "en" | "zh";
  /** the visitor tapped, by id ("shy:one", "kin:<bornAt>" or a player's id), or null */
  picked: string | null;
  setPicked: (id: string | null) => void;
  shyOne: { name: string } | null;
  forestFlags: readonly string[];
  kinVisitors: readonly { id: string; name: string; who: string }[];
}

export function VisitorCards({ pet, lang, picked, setPicked, shyOne, forestFlags, kinVisitors }: VisitorCardsProps) {
  const others = useLive((s) => s.members);
  const liveEmote = useLive((s) => s.emote);
  const liveAsk = useLive((s) => s.ask);
  const livePropose = useLive((s) => s.propose);
  const meet = useFriends((s) => s.meet);
  const friendsAll = useFriends((s) => s.all);
  const roster = useGame((s) => s.pets);
  const setWorldMsg = useWorldMessage((s) => s.show);
  // who was tapped, looked up once: a relative of this device's, or another player's pet in the room
  const kin = picked?.startsWith("kin:") ? kinVisitors.find((k) => k.id === picked) : undefined;
  const other = picked ? others[picked] : undefined;
  return (
    <>
      {picked === "shy:one" && shyOne && (
        <div className="visitor-card" role="dialog" aria-label={shyOne.name}>
          <b>{shyOne.name}</b>
          <span className="small">
            {forestFlags.includes("shy-friend")
              ? lang === "zh"
                ? `它现在敢待在${pet.name}身边了。白天你见不到它。`
                : `It stays near ${pet.name} now. You will never see it by day.`
              : lang === "zh"
                ? `在树影边上看着${pet.name}，从不靠近。`
                : `At the edge of the trees, watching ${pet.name}. It never comes close.`}
          </span>
          <button
            type="button"
            className="icon-x"
            aria-label={lang === "zh" ? "关闭" : "Close"}
            onClick={() => setPicked(null)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {kin && (
        <div className="visitor-card" role="dialog" aria-label={kin.name}>
          <b>{kin.name}</b>
          <span className="small">{kin.who}</span>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const id = Number(kin.id.slice(4));
              const index = roster.findIndex((x) => x.bornAt === id);
              setPicked(null);
              if (index >= 0) {
                play("tap");
                useGame.getState().switchTo(index);
              }
            }}
          >
            {lang === "zh" ? "换成它" : "Switch to it"}
          </button>
          <button
            type="button"
            className="icon-x"
            aria-label={lang === "zh" ? "关闭" : "Close"}
            onClick={() => setPicked(null)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {picked && other && (
        <div className="visitor-card" role="dialog" aria-label={other.name}>
          <b>{other.name}</b>
          <span className="small visitor-bond">
            {bondName(bondLevel(bondsOf(friendsAll, pet.bornAt)[friendKey(picked, other.name)]?.points ?? 0), lang)}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => (
              play("pop"),
              liveEmote("heart", picked),
              meet(picked, { name: other.name, line: other.line }, "heart"),
              setPicked(null)
            )}
          >
            <Icon name="heart" size={16} /> {lang === "zh" ? "送心" : "Heart"}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => (
              play("tap"),
              liveAsk(picked),
              meet(picked, { name: other.name, line: other.line }, "spar"),
              setPicked(null)
            )}
          >
            <Icon name="paw" size={16} /> {lang === "zh" ? "切磋" : "Spar"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const block =
                familyBlock(pet, other.stage, lang) ??
                bondBlock(
                  pet,
                  bondsOf(friendsAll, pet.bornAt)[friendKey(other.id, other.name)]?.points ?? 0,
                  other.name,
                  lang,
                );
              setPicked(null);
              if (block) return setWorldMsg({ id: now(), text: block, ms: 4500 });
              play("tap");
              livePropose(other.id, useChain.getState().infoOf(pet) ?? undefined);
              setWorldMsg({
                id: now(),
                text:
                  lang === "zh"
                    ? `问过${other.name}的主人了，等回复……`
                    : `Asked ${other.name}'s owner. Waiting for an answer…`,
                ms: 4000,
              });
            }}
          >
            <Icon name="heart" size={16} /> {lang === "zh" ? "家人" : "Family"}
          </button>
          <button
            type="button"
            className="icon-x"
            aria-label={lang === "zh" ? "关闭" : "Close"}
            onClick={() => setPicked(null)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </>
  );
}
