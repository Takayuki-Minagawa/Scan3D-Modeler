/*
 * Based on coi-serviceworker v0.1.7 by Guido Zuidhof and contributors (MIT).
 * Adapted for Scan2FEM to combine cross-origin isolation with an offline
 * same-origin runtime cache. The upstream notice is included in
 * third-party-licenses.txt.
 */

// Cache names are scoped so a second deployment under the same origin cannot delete ours.
const SCOPE_KEY = encodeURIComponent(new URL(self.registration.scope).pathname);
const CACHE_PREFIX = `scan2fem-shell-${SCOPE_KEY}-`;
const BUILD_ID = /*__SCAN2FEM_BUILD_ID__*/ 'source';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
// The generated production worker replaces these two lists. Only resources required to boot the
// app belong in the atomic shell list. Lazy chunks, icons, and notices are warmed independently so
// one optional download cannot prevent COOP/COEP control or installation of the offline shell.
const SHELL_PRECACHE_PATHS = /*__SCAN2FEM_SHELL_PRECACHE_PATHS__*/ [
  './',
  './index.html',
];
const OPTIONAL_PRECACHE_PATHS = /*__SCAN2FEM_OPTIONAL_PRECACHE_PATHS__*/ [
  './manifest.webmanifest',
  './favicon.svg',
];
const ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function withIsolationHeaders(response) {
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function warmOptionalResources() {
  const scope = self.registration.scope;
  const cache = await caches.open(CACHE_NAME);
  const optionalResults = await Promise.allSettled(
    OPTIONAL_PRECACHE_PATHS.map(async (path) => {
      const resourceUrl = new URL(path, scope).href;
      if (await cache.match(resourceUrl)) return;
      await cache.add(resourceUrl);
    }),
  );
  const failedOptionalPaths = OPTIONAL_PRECACHE_PATHS.filter(
    (_path, index) => optionalResults[index].status === 'rejected',
  );
  if (failedOptionalPaths.length > 0) {
    console.warn('Scan2FEM optional offline resources were not cached', failedOptionalPaths);
  }
}

async function installOfflineShell() {
  const scope = self.registration.scope;
  const cache = await caches.open(CACHE_NAME);

  await cache.addAll(SHELL_PRECACHE_PATHS.map((path) => new URL(path, scope).href));

  // 初回導入だけは現在のdocumentを分離実行にするため即時有効化する。
  // 更新時は録画・編集中のタブを強制reloadせず、UIからの明示操作を待つ。
  if (!self.registration.active) await self.skipWaiting();
}

self.addEventListener('install', (event) => {
  event.waitUntil(installOfflineShell());
});

async function cleanupOldCachesIfSafe(requestingClientId) {
  // A still-open tab may execute an older hashed lazy chunk or worker at any time. Only the
  // sole window client may authorize cleanup; a newly loaded/focused page retries later.
  if (self.registration.installing || self.registration.waiting) return;
  const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (
    windowClients.length !== 1 ||
    !requestingClientId ||
    windowClients[0].id !== requestingClientId
  ) {
    return;
  }
  const scopedCaches = (await caches.keys()).filter(
    (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME,
  );
  // An update can begin while client enumeration is in flight. Never remove the cache being
  // populated by an installing/waiting successor.
  if (self.registration.installing || self.registration.waiting) return;
  await Promise.all(scopedCaches.map((key) => caches.delete(key)));
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'activateUpdate') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'warmOptionalResources') {
    event.waitUntil(warmOptionalResources());
  } else if (event.data?.type === 'cleanupOldCaches') {
    event.waitUntil(
      cleanupOldCachesIfSafe(event.source?.id).finally(() => {
        event.ports[0]?.postMessage({ done: true });
      }),
    );
  }
});

self.addEventListener('activate', (event) => {
  // Do not delete the previous shell here: other tabs intentionally remain on their current
  // page until their users approve a reload. A sole current page requests cleanup later.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  event.respondWith(
    (async () => {
      // Versioned build assets are immutable inside one deployment. Cache-first keeps every
      // already-installed screen (including lazy viewer/workers) usable while offline.
      if (sameOrigin && request.mode !== 'navigate') {
        const currentCache = await caches.open(CACHE_NAME);
        const cached = (await currentCache.match(request)) ?? (await caches.match(request));
        if (cached) return withIsolationHeaders(cached);
      }

      let response = null;
      try {
        response = await fetch(request);
      } catch {
        const currentCache = await caches.open(CACHE_NAME);
        response = (await currentCache.match(request)) ?? (await caches.match(request));
        if (!response && request.mode === 'navigate') {
          response = await currentCache.match(self.registration.scope);
        }
      }

      if (!response) return Response.error();
      if (sameOrigin && response.ok) {
        // Quota/caching failures must never turn a successful network request into an app error.
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch (error) {
          console.warn('Scan2FEM offline cache write failed', error);
        }
      }
      return withIsolationHeaders(response);
    })(),
  );
});
