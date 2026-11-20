// The mind check's worker entry (A62), in plain JavaScript for the reason standingsBoot.mjs gives: it registers tsx in
// this thread, then runs the check.
import { register } from "tsx/esm/api";

register();
await import("./mindWork.ts");
