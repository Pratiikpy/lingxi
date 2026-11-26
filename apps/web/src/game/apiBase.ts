/**
 * The game's server address and its live rooms' address, read in one place (R3). The web build names its server (VITE_API_URL); the on-chain copy
 * on DeWEB is built with it empty and has no server; a page on localhost with no address talks to the local server.
 * Every module takes its server address from here; a guard (scripts/apiBase.test.mts) fails on any other reader.
 */

/** The address the build names, if any ("" for the on-chain copy, which has no server). */
export const ENV_API = import.meta.env.VITE_API_URL as string | undefined;

/** The server a developer runs on this machine. */
export const LOCAL_API = "http://localhost:8787";

/** Whether this page is served from localhost (false where there is no page, as in a test outside a browser). */
export const ON_LOCALHOST = typeof location !== "undefined" && location.hostname === "localhost";

/** The game's server: the build's address, else the local server on localhost, else none (""). */
export const API_BASE: string = ENV_API ?? (ON_LOCALHOST ? LOCAL_API : "");

/** The live rooms' websocket: the build's (VITE_LIVE_URL), else the local server's on localhost, else none. */
export const LIVE_URL: string =
  (import.meta.env.VITE_LIVE_URL as string | undefined) ?? (ON_LOCALHOST ? "ws://localhost:8787/live" : "");
