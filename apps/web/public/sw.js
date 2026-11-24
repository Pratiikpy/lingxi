/*
 * Lingxi's service worker: the game opens offline, and reminders open the game when one is tapped (P6).
 *
 * The build writes PRECACHE below (vite.config.ts offlineWorker): the game page and every script, style and font its
 * first screen needs, under the build's own version, so each release installs a fresh copy and clears the last.
 * - pages: from the network first (a short wait), else the copy kept here, so a new release is always seen online
 * - scripts and styles (their names change with every build): from here first, else the network, kept once fetched
 * - art: from here at once, refreshed from the network behind it
 * - the API and live rooms: never kept; the game says what needs the internet
 * The on-chain copy never registers this worker: its gateway's own verifier stays in charge of its pages.
 */
/* global PRECACHE -- written in by the build, on the line below */
/*__PRECACHE__*/
const KEEP = typeof PRECACHE !== "undefined" ? PRECACHE : { version: "dev", files: [] };
const CACHE = `lingxi-${KEEP.version}`;
const ART = "lingxi-art";
const PAGE_WAIT_MS = 3500;

self.addEventListener("install", (e) => {
  // a file that cannot be fetched now is fetched later, when it is first asked for
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(KEEP.files.map((f) => c.add(new Request(f, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  // the last release's copy goes; an open page of it loads anything it still needs from the network
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lingxi-") && k !== CACHE && k !== ART).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const fromNetworkFirst = async (request) => {
  const cache = await caches.open(CACHE);
  try {
    const answer = await Promise.race([fetch(request), new Promise((_, no) => setTimeout(() => no(new Error("slow")), PAGE_WAIT_MS))]);
    if (answer.ok) await cache.put(request, answer.clone());
    return answer;
  } catch {
    const kept = (await cache.match(request, { ignoreSearch: true })) ?? (await caches.match(request, { ignoreSearch: true }));
    if (kept) return kept;
    throw new Error("offline, and this page is not kept");
  }
};

const fromCacheFirst = async (request) => {
  const kept = await caches.match(request);
  if (kept) return kept;
  const answer = await fetch(request);
  if (answer.ok) await (await caches.open(CACHE)).put(request, answer.clone());
  return answer;
};

const fromCacheThenRefresh = async (request, event) => {
  const cache = await caches.open(ART);
  const kept = await cache.match(request);
  const fresh = fetch(request)
    .then(async (answer) => {
      if (answer.ok) await cache.put(request, answer.clone());
      return answer;
    })
    .catch(() => undefined);
  if (kept) {
    event.waitUntil(fresh);
    return kept;
  }
  const answer = await fresh;
  if (answer) return answer;
  throw new Error("offline, and this art is not kept");
};

self.addEventListener("fetch", (e) => {
  const request = e.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith("/api/") || path.startsWith("/live")) return;
  if (request.mode === "navigate" || path.endsWith(".html") || path === "/") e.respondWith(fromNetworkFirst(request));
  else if (path.includes("/assets/")) e.respondWith(fromCacheFirst(request));
  else if (path.includes("/art/") || path.includes("/icons/") || path.endsWith(".webmanifest") || path.endsWith(".png")) e.respondWith(fromCacheThenRefresh(request, e));
});

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title.slice(0, 80) : "Lingxi";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "";
  // the installed app's icon also shows that the pet wants you (Y1)
  if (self.navigator && self.navigator.setAppBadge) self.navigator.setAppBadge(1).catch(() => {});
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "lingxi-reminder",
      renotify: true,
      data: { url: "play.html" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL("play.html", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(url));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
