/**
 * P7: what puts messages over the world without anything being tapped: a birth sent before the page closed and found
 * on X Layer since (A48), the server not keeping the home's decorations, and the world's own notices; and the timer that
 * takes each message away once it has been read. Out of PlayApp so these read as their own.
 */
import { useEffect, useEffectEvent } from "react";
import type { Pet } from "@lingxi/game";
import { useLang, useT } from "../../i18n";
import { useChain } from "../../game/chain";
import { useLive } from "../../game/live";
import { noticeText } from "../../game/noticeText";
import { play } from "../../game/sound";
import { useGame } from "../../game/store";
import { useWorld } from "../../game/world";
import { useWorldMessage } from "./worldMessage";

export function useWorldNotices(): void {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const show = useWorldMessage((s) => s.show);

  // each message for as long as it takes to read; a newer one replaces it and starts its own time
  const msg = useWorldMessage((s) => s.msg);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => {
      if (useWorldMessage.getState().msg === msg) useWorldMessage.getState().clear();
    }, msg.ms);
    return () => clearTimeout(id);
  }, [msg]);

  // a birth sent before the page closed and found on X Layer since: its little one comes home now (A48)
  const welcomeFound = useEffectEvent((found: Array<{ child: Pet }>) => {
    for (const { child } of found) if (useGame.getState().adopt(child)) play("success");
    if (found.length)
      show({
        id: `births:${found.map((f) => f.child.bornAt).join(",")}`,
        text:
          lang === "zh"
            ? `${found.map((f) => f.child.name).join("、")}在 X Layer 上出生了，已经回到你的宠物里。`
            : `${found.map((f) => f.child.name).join(" and ")} was born on X Layer and has joined your pets.`,
        ms: 6000,
      });
  });
  useEffect(() => {
    void useChain.getState().finishBirths().then(welcomeFound);
  }, []);

  // the server didn't keep our decorations: say so, since visitors will not see them; once per refusal, in the
  // language of that moment
  const sayDecorRefused = useEffectEvent(
    (refused: NonNullable<ReturnType<typeof useLive.getState>["decorRefused"]>) => {
      const text =
        refused.reason === "tooMany"
          ? lang === "zh"
            ? "访客明天才能看到你的新布置：这个网络地址今天开的新家够多了。"
            : "Visitors will see your new decorations from tomorrow: this address has started enough new homes today."
          : lang === "zh"
            ? "访客暂时看不到你的布置，下次改动时会再发送。"
            : "Visitors can't see your decorations for now; they'll be sent again on your next change.";
      show({ id: Math.round(refused.at), text, ms: 6000 });
    },
  );
  useEffect(
    () =>
      useLive.subscribe(
        (s, before) => s.decorRefused && s.decorRefused !== before.decorRefused && sayDecorRefused(s.decorRefused),
      ),
    [],
  );

  // a new notice on every event, in the words and language of that moment
  const sayNotice = useEffectEvent((notice: NonNullable<ReturnType<typeof useWorld.getState>["notice"]>) => {
    const text = noticeText(notice, t, lang);
    if (text) show({ id: notice.id, text, ms: 2800 });
  });
  useEffect(() => useWorld.subscribe((s, before) => s.notice && s.notice !== before.notice && sayNotice(s.notice)), []);
}
