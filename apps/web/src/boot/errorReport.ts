/**
 * P8: the game reports its own uncaught errors to its server (POST /api/errors), so real players' bugs are seen
 * without anyone writing in. Only errors from the game's own scripts are sent (a browser extension's are not ours),
 * each distinct one once and at most five a visit, as its message, where it happened and the build: nothing about the
 * player. The server scrubs and limits them again (services/api/src/clientErrors.ts). With no server, as the on-chain
 * copy is built, nothing listens and nothing is sent.
 */

const MAX_PER_VISIT = 5;
/** The server's caps (ClientErrorBody): longer fields are cut, never refused. */
const CAP = { message: 300, where: 200, build: 40 } as const;

type Report = { message: string; where: string; build: string };

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (location.hostname === "localhost" ? "http://localhost:8787" : "");

/** The build a page runs: the file this module was bundled into, which changes with every release. */
const BUILD = new URL(import.meta.url).pathname.split("/").pop() ?? "";

/** A file of ours, as a path: only scripts served from this page's own origin. */
const ownPath = (file: string): string | null =>
  file.startsWith(`${location.origin}/`) ? file.slice(location.origin.length) : null;

/** Where the first frame of a stack that is ours points, as "path:line:col". */
function ownFrame(stack: string): string | null {
  for (const m of stack.matchAll(/(https?:\/\/[^\s)]+):(\d+):(\d+)/g)) {
    const path = ownPath(m[1] ?? "");
    if (path) return `${path}:${m[2]}:${m[3]}`;
  }
  return null;
}

const send = (url: string, body: Report): void => {
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    // a report that cannot be sent is let go: the page is never troubled by its own error reporting
  }).catch(() => undefined);
};

export function startErrorReports(
  o: { base?: string; build?: string; send?: (url: string, body: Report) => void } = {},
): () => void {
  const base = o.base ?? API_BASE;
  if (!base) return () => {};
  const build = (o.build ?? BUILD).slice(0, CAP.build);
  const post = o.send ?? send;
  const seen = new Set<string>();
  const report = (message: string, at: string) => {
    const body = {
      message: message.slice(0, CAP.message),
      where: `${location.pathname} ${at}`.slice(0, CAP.where),
      build,
    };
    const key = `${body.message}\n${body.where}`;
    if (seen.has(key) || seen.size >= MAX_PER_VISIT) return;
    seen.add(key);
    post(`${base}/api/errors`, body);
  };
  const onError = (e: ErrorEvent) => {
    const path = ownPath(e.filename ?? "");
    if (path) report(e.message || "error", `${path}:${e.lineno}:${e.colno}`);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    if (!(reason instanceof Error)) return;
    const at = ownFrame(reason.stack ?? "");
    if (at) report(`${reason.name}: ${reason.message}`, at);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
