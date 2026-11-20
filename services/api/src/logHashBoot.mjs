// The diary hash worker's entry (A114), in plain JavaScript for the reason standingsBoot.mjs gives: it registers tsx in
// this thread, then runs the hash.
import { register } from "tsx/esm/api";

register();
await import("./logHashWork.ts");
