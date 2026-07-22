/**
 * Minimal hand-written service worker (spec Section 1 - "Responsive,
 * PWA-based application"). Deliberately NOT built via next-pwa/
 * workbox (no new npm dependency was added for this, since the
 * sandbox this was authored in has no package-registry access to
 * install/verify one) - this is a small, self-contained
 * install-and-cache-shell worker instead:
 *
 *  - On install, pre-caches the login page and a tiny offline
 *    fallback shell so the app can at least show something useful
 *    when there's no network (e.g. a parent opening the installed
 *    app in a low-connectivity area).
 *  - On fetch, uses a network-first strategy for navigation requests
 *    (falls back to the cached offline shell only if the network
 *    request fails entirely) - this app is a live data dashboard, so
 *    serving a stale cached dashboard instead of hitting the network
 *    would be actively misleading (wrong attendance/fee/exam data).
 *    Static assets (JS/CSS/images) use a cache-first strategy since
 *    those are content-hashed by Next.js and safe to cache long-term.
 *
 * This intentionally does NOT try to cache/serve API responses
 * (/api/**) - this is a live administrative system (fees, attendance,
 * grades); offline-first caching of that data risks a staff member
 * acting on stale information, which is worse than no PWA at all.
 * True offline-first data sync is a larger feature (would need a
 * proper local write-queue + conflict resolution) intentionally left
 * for a future iteration - see the PR description for this
 * limitation.
 */

const CACHE_NAME = "school-erp-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/auth/login", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API calls or non-GET requests - see doc comment
  // above for why live app data is deliberately excluded from this
  // worker's caching.
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res || Response.error()))
    );
    return;
  }

  // Static assets (Next.js content-hashed JS/CSS/images) - cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
      )
    );
  }
});
