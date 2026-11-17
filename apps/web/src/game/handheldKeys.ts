/**
 * Where the game and the browser handheld leave packets for each other (plan 4.14), kept apart from the game's
 * stores so the handheld page loads nothing of the game.
 */

/** the game's side of a trip: the pet as it left, the snacks, the brain */
export const TRIP_KEY = "lingxi.handheld.trip.v1";
/** a packet waiting for the browser handheld */
export const INBOX_KEY = "lingxi.handheld.inbox.v1";
/** the browser handheld's own memory: the packet it holds and its log */
export const DEVICE_KEY = "lingxi.handheld.device.v1";
/** the packet back, waiting for the game */
export const RETURN_KEY = "lingxi.handheld.return.v1";

export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
