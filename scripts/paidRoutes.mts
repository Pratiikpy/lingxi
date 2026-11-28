/**
 * The game server's routes that spend money on every call (a model's words, a TapeOut, a sponsored keep): voice,
 * teach, every tapeout and every sponsor route. A script that drives the game unattended (the screen inventory) blocks
 * them, so a look round the screens never pays for anything; the live game asks /api/voice about every 45 s while a
 * pet is on screen.
 */
export const PAID_ROUTES = /^\/api\/(?:voice|teach|tapeout|sponsor)(?:[/-]|$)/;

/** Whether a request to `url` (absolute, or a path) would be a paid call: its path, never its query, decides. */
export const isPaid = (url: string): boolean => PAID_ROUTES.test(new URL(url, "http://localhost").pathname);
