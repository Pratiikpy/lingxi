/**
 * A player's public id (in rooms, home links and invites) is derived from the secret key their device holds, so the
 * server can tell the id's owner without remembering anyone first: whoever shows the key behind an id is its owner,
 * and seeing an id in a room or a link gives no way to take it.
 */

import { sha256, stringToBytes } from "viem";

/** The secret a device holds for its player id and home: 32 lowercase hex characters. */
export const PLAYER_SECRET = /^[a-f0-9]{32}$/;

/** The public player id that belongs to `secret`: 24 hex characters. */
export function playerIdFor(secret: string): string {
  return sha256(stringToBytes(`lingxi-player:${secret}`)).slice(2, 26);
}
