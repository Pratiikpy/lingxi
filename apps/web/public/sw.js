/*
 * Lingxi's service worker: the game opens offline, and reminders open the game when one is tapped (P6).
 *
 * The build writes PRECACHE below (vite.config.ts offlineWorker, src/boot/offlineList.ts): the game page, every script
 * the game can load (the lazy ones too) with its styles and faces, and the home room's pictures, under the build's own
 * version, so each release installs a fresh copy and clears the last. All of it is fetched here as the worker installs:
 * the code a first visit loads arrives before the worker takes control, so only what it fetches itself is there offline
 * (R61). A file the network fails then is fetched on a later visit.
 * - pages: from the network first (a short wait), else the copy kept here, so a new release is always seen online;
 *   with no copy kept, the network however slow it is (R10)
 * - scripts, styles and faces (their names change with every build): from here first, else the network, kept once
 *   fetched
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

// a script, a style or a face is asked with the page's Origin header, and the worker kept it without one: a server or
// CDN answering with Vary: Origin (Vite's own preview does) would make every kept copy miss offline. A file named by
// its content, or a picture, is the same whoever asks, so the match ignores Vary (R61)
const SAME_FOR_ALL = { ignoreVary: true };

/** Where a kept file lives: the art with the art, which outlives a release; the rest under this release. */
const storeFor = (file) => (file.startsWith("art/") ? ART : CACHE);

// whether every file of the list is kept, as far as this worker knows: unknown again each time the worker wakes,
// unless it has nothing to keep (a build without a list)
let allKept = KEEP.files.length === 0;

/**
 * Fetches each file of the list that is not kept yet. The code, named by its content, may come from the browser's own
 * cache (a first visit has just fetched most of it); the page and the art are asked fresh. A file the network fails is
 * left for the next visit; true when all are kept.
 */
const keepAll = async () => {
  const stores = { [CACHE]: await caches.open(CACHE), [ART]: await caches.open(ART) };
  const results = await Promise.allSettled(
    KEEP.files.map(async (f) => {
      const store = stores[storeFor(f)];
      const request = new Request(f, { cache: f.startsWith("assets/") ? "default" : "reload" });
      if (await store.match(request, SAME_FOR_ALL)) return;
      await store.add(request);
    }),
  );
  allKept = results.every((r) => r.status === "fulfilled");
  return allKept;
};

self.addEventListener("install", (e) => {
  e.waitUntil(keepAll().then(() => self.skipWaiting()));
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

const fromNetworkFirst = async (request, event) => {
  const cache = await caches.open(CACHE);
  // the one request to the network: its answer is kept whenever it comes, however late (R10)
  const fresh = fetch(request).then(async (answer) => {
    if (answer.ok) await cache.put(request, answer.clone());
    return answer;
  });
  const slow = new Promise((yes) => setTimeout(() => yes("slow"), PAGE_WAIT_MS));
  // the network's answer if it comes within the short wait; "slow" if it has not come yet; "down" if it failed
  const first = await Promise.race([fresh, slow]).catch(() => "down");
  if (first !== "slow" && first !== "down") return first;
  const kept = (await cache.match(request, { ignoreSearch: true })) ?? (await caches.match(request, { ignoreSearch: true }));
  if (kept) {
    // the copy kept here opens now; an answer still on its way refreshes it for next time
    event.waitUntil(fresh.catch(() => undefined));
    return kept;
  }
  // nothing kept, and the network is only slow: its answer is the page, however long it takes. It used to fail here
  // after the short wait ("offline, and this page is not kept") though the server was about to answer.
  if (first === "slow") return fresh;
  throw new Error("offline, and this page is not kept");
};

const fromCacheFirst = async (request) => {
  const kept = await caches.match(request, SAME_FOR_ALL);
  if (kept) return kept;
  const answer = await fetch(request);
  if (answer.ok) await (await caches.open(CACHE)).put(request, answer.clone());
  return answer;
};

const fromCacheThenRefresh = async (request, event) => {
  const cache = await caches.open(ART);
  const kept = await cache.match(request, SAME_FOR_ALL);
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
  if (request.mode === "navigate" || path.endsWith(".html") || path === "/") {
    e.respondWith(fromNetworkFirst(request, e));
    // a file the network failed while the worker installed is fetched now, while the page is online; a store that
    // cannot be opened is tried again on the next visit, and the page is answered either way
    if (!allKept) e.waitUntil(keepAll().catch(() => undefined));
  } else if (path.includes("/assets/")) e.respondWith(fromCacheFirst(request));
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
