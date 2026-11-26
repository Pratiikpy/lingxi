/**
 * R8: what the game says aloud. A screen reader reads a live region only when its text changes while the region is
 * already on the page. The care note ("Kiko ate it all up.") and the pet's words were each a new element that arrived
 * holding its text, and NVDA said nothing after a feed, a bath or a pat. So one polite region is always on the page,
 * out of sight, and each new note and each new line is put into it as a new node, which is what makes it read (the
 * same note twice is read twice). The notes on screen stay as they are, for the eye.
 */
import { useEffect, useRef, useState } from "react";
import { useGame } from "../game/store";
import { useVoice } from "../game/voice";
import { useLang, useT, type Key } from "../i18n";

/** `voice`: the pet's own words are shown now (no sheet is over the room), so they are said too. */
export function Announcer({ name, voice }: { name: string; voice: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const [said, setSaid] = useState<{ key: string; text: string } | null>(null);
  // the words of the moment a note or a line arrives: the name, the language and whether the pet may speak
  const now = useRef({ t, lang, name, voice });
  useEffect(() => {
    now.current = { t, lang, name, voice };
  });
  useEffect(() => {
    const offNote = useGame.subscribe((s, was) => {
      if (!s.toast || s.toast.id === was.toast?.id) return;
      const { t, name } = now.current;
      setSaid({ key: `note-${s.toast.id}`, text: t(`note.${s.toast.note}` as Key, { name }) });
    });
    const offLine = useVoice.subscribe((s, was) => {
      if (!s.line || s.id === was.id || !now.current.voice) return;
      const { lang, name } = now.current;
      setSaid({ key: `line-${s.id}`, text: lang === "zh" ? `${name}说：${s.line}` : `${name} says: ${s.line}` });
    });
    return () => {
      offNote();
      offLine();
    };
  }, []);
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {said && <span key={said.key}>{said.text}</span>}
    </div>
  );
}
