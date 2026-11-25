/**
 * The nine residents as friends (plan 4.3): what each loves, likes and turns down, what they say to a gift, and
 * the seven steps of each friendship. At level 3 each offers a choice: buy their special thing from their shelf
 * from then on, or learn to make it yourself. Either road leads on.
 */

import type { FriendSheet } from "../friendship";
import { WICK } from "./cast/wick";
import { PRALINE } from "./cast/praline";
import { YONDER } from "./cast/yonder";
import { TWAIN } from "./cast/twain";
import { BOLT } from "./cast/bolt";
import { FLIT } from "./cast/flit";
import { WHY } from "./cast/why";
import { JAB } from "./cast/jab";
import { NIMBUS } from "./cast/nimbus";

export const RESIDENT_FRIENDS: readonly FriendSheet[] = [WICK, PRALINE, YONDER, TWAIN, BOLT, FLIT, WHY, JAB, NIMBUS];
