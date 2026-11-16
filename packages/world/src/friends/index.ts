/** Every friend (plan 4.3): the nine residents and the five Builders' Lane pets. */

import type { FriendSheet } from "../friendship";
import { LANE_FRIENDS } from "./lane";
import { RESIDENT_FRIENDS } from "./residents";

export const FRIENDS: readonly FriendSheet[] = [...RESIDENT_FRIENDS, ...LANE_FRIENDS];
export const FRIEND_BY_ID: Readonly<Record<string, FriendSheet>> = Object.fromEntries(FRIENDS.map((f) => [f.id, f]));
