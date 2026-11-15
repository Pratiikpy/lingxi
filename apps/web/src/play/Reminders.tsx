/** Gentle reminders: one switch, with an honest note when this browser can't receive them. */

import type { Pet } from "@lingxi/game";
import { useLang, useT } from "../i18n";
import { support, useReminders } from "../game/reminders";
import { play } from "../game/sound";

export function RemindersPanel({ pet }: { pet: Pet }) {
  const t = useT();
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const { on, busy, error, enable, disable } = useReminders();
  const can = support();
  if (can === "noServer") return null;
  return (
    <div className="chainpanel reminders">
      <p className="label">{t("remind.title")}</p>
      <p className="small">{t("remind.pitch", { name: pet.name })}</p>
      {can === "ok" ? (
        <button type="button" className={on ? "btn" : "btn primary"} disabled={busy} aria-pressed={on} onClick={() => (play("tap"), on ? disable() : enable(pet, lang))}>
          {on ? t("remind.off") : t("remind.on")}
        </button>
      ) : (
        <p className="small">{t(can === "needsHomeScreen" ? "remind.homeScreen" : "remind.unsupported")}</p>
      )}
      {on && <p className="small">{t("remind.quiet")}</p>}
      {error && (
        <p className="err" role="alert">
          {t(error === "denied" ? "remind.denied" : "remind.failed")}
        </p>
      )}
    </div>
  );
}
