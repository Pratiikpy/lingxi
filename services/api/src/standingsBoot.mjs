// The standings worker's entry (A38), in plain JavaScript: Node's own TypeScript stripping would load a .ts entry
// before tsx's resolver, and the workspace packages' extensionless imports need tsx's. It registers tsx in this
// thread, then runs the fight.
import { register } from "tsx/esm/api";

register();
await import("./standingsWork.ts");
