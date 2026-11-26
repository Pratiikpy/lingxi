/**
 * P6: a quiet note while the connection is down. The game itself goes on (the pet lives on this device, and a visited
 * game opens offline, public/sw.js); the note says so, and that what needs the internet waits for it.
 *
 * R24: in the room it is the first notice in the room's lane (NoticeLane), over the room's sky and never over a
 * control; it stays while the connection is down and the lane's other notices still come and go under it. Where the
 * lane is a phone's width it keeps to one line (notice-lane.css), the whole sentence kept for a screen reader. Before
 * there is a pet (no room, no lane) it sits at the top of the page, in its flow.
 */
import { useSyncExternalStore } from "react";
import { useT } from "../i18n";

const subscribe = (changed: () => void) => {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
};
const isOffline = () => navigator.onLine === false;

export function OfflineNote() {
  const t = useT();
  const offline = useSyncExternalStore(subscribe, isOffline, () => false);
  return (
    <p className="offline-note" role="status" hidden={!offline}>
      {offline && (
        <>
          <span className="offline-full">{t("offline.note")}</span>
          <span className="offline-short" aria-hidden="true">
            {t("offline.short")}
          </span>
        </>
      )}
    </p>
  );
}
