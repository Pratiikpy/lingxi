/**
 * P6: a quiet note while the connection is down. The game itself goes on (the pet lives on this device, and a visited
 * game opens offline, public/sw.js); the note says so, and that what needs the internet waits for it.
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
      {offline ? t("offline.note") : ""}
    </p>
  );
}
