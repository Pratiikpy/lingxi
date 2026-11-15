/**
 * Lingxi as a Telegram Mini App (PRD S11). Inside Telegram the game takes the
 * chat app's light or dark theme and language, fills the screen, uses Telegram's
 * back button to close a sheet, and taps with Telegram's haptics. Telegram's
 * in-app view has no wallet, so anything that needs one moves the pets to the
 * browser (see move.ts). Outside Telegram every function here does nothing.
 * Docs: https://core.telegram.org/bots/webapps
 */

interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { language_code?: string }; start_param?: string };
  version: string;
  colorScheme: "light" | "dark";
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  onEvent(e: string, cb: () => void): void;
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(cb: (status: "unsupported" | "unknown" | "added" | "missed") => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: { impactOccurred(s: "light" | "medium" | "heavy" | "rigid" | "soft"): void; notificationOccurred(t: "error" | "success" | "warning"): void; selectionChanged(): void };
}

function app(): TgWebApp | null {
  const w = (globalThis as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
  // the script also loads outside Telegram (for instance after a reload); only a real launch carries initData
  return w && w.initData ? w : null;
}

export const inTelegram = (): boolean => app() !== null;

/** The language Telegram reports for this player, if it is one Lingxi speaks. */
export function telegramLang(): "en" | "zh" | null {
  const code = app()?.initDataUnsafe.user?.language_code?.toLowerCase();
  return !code ? null : code.startsWith("zh") ? "zh" : "en";
}

/** The start parameter of a t.me/<bot>?startapp=<param> link. */
export const telegramStart = (): string | null => app()?.initDataUnsafe.start_param ?? null;

function paintChrome(tg: TgWebApp): void {
  document.documentElement.dataset.theme = tg.colorScheme;
  if (!tg.isVersionAtLeast("6.1")) return;
  // after the theme is applied, match Telegram's header and background to the page
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const hex = toHex(bg);
    if (!hex) return;
    tg.setHeaderColor(hex);
    tg.setBackgroundColor(hex);
  });
}

function toHex(rgb: string): string | null {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : null;
}

/** Called once at start: theme, full height, no swipe-to-close over the game. */
export function startTelegram(): void {
  const tg = app();
  if (!tg) return;
  document.documentElement.classList.add("in-telegram");
  paintChrome(tg);
  tg.onEvent("themeChanged", () => paintChrome(tg));
  tg.expand();
  if (tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes?.();
  tg.ready();
}

let backHandler: (() => void) | null = null;
/** Shows Telegram's back button while a sheet is open; tapping it runs `onBack`. */
export function telegramBack(onBack: (() => void) | null): void {
  const tg = app();
  if (!tg || !tg.isVersionAtLeast("6.1")) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = onBack;
  if (onBack) {
    tg.BackButton.onClick(onBack);
    tg.BackButton.show();
  } else tg.BackButton.hide();
}

/** Telegram's haptics for a game sound, when there is one to match. */
export function telegramHaptic(fx: string): void {
  const tg = app();
  if (!tg || !tg.isVersionAtLeast("6.1")) return;
  if (fx === "success" || fx === "sparkle" || fx === "hatch") tg.HapticFeedback.notificationOccurred("success");
  else if (fx === "error") tg.HapticFeedback.notificationOccurred("error");
  else if (fx === "tap" || fx === "pop") tg.HapticFeedback.impactOccurred("light");
}

/** Opens a page in the phone's own browser, leaving the Mini App open. */
export function openInBrowser(url: string): boolean {
  const tg = app();
  if (!tg) return false;
  tg.openLink(url);
  return true;
}

/** Whether Telegram can still add Lingxi to the home screen (8.0+, only when not added yet). */
export function homeScreenMissing(): Promise<boolean> {
  const tg = app();
  if (!tg || !tg.isVersionAtLeast("8.0") || !tg.checkHomeScreenStatus) return Promise.resolve(false);
  return new Promise((done) => {
    const t = setTimeout(() => done(false), 1500);
    tg.checkHomeScreenStatus!((s) => (clearTimeout(t), done(s === "missed")));
  });
}

/** Asks Telegram to put Lingxi on the home screen. */
export function addToHomeScreen(): void {
  app()?.addToHomeScreen?.();
}
