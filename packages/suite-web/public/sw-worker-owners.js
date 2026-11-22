// SPDX-License-Identifier: MPL-2.0

// Imported by the generated service worker (rspackConfigs.ts). Remembers which window created each
// worker, so a build file a worker can't load is reported to that window (fetchDidSucceed in
// rspackConfigs.ts, recoverFromMissingAssets in useServiceWorkerUpdate.ts).
// Kept in Cache Storage too: the browser stops an idle service worker while its pages and their
// workers keep running, and a restarted one must still know the owners.
const OWNERS_CACHE = "lichtblick-worker-owners";
/** A worker created this recently may not be listed by clients.matchAll yet: never prune it */
const PRUNE_GRACE_MS = 60_000;
const ownerByWorker = new Map();

const ownerKey = (workerId) =>
  new URL(`__worker-owner/${encodeURIComponent(workerId)}`, self.registration.scope).href;
const workerIdOf = (key) => decodeURIComponent(key.slice(key.lastIndexOf("/") + 1));

async function rememberOwner(workerId, ownerId) {
  const cache = await caches.open(OWNERS_CACHE);
  await cache.put(ownerKey(workerId), Response.json({ ownerId, at: Date.now() }));
  // Forget workers that are gone, so the store doesn't grow
  const clients = await self.clients.matchAll({ type: "all", includeUncontrolled: true });
  const live = new Set(clients.map((client) => client.id));
  for (const request of await cache.keys()) {
    const id = workerIdOf(request.url);
    if (live.has(id)) {
      continue;
    }
    const entry = await (await cache.match(request))?.json();
    if (entry == undefined || Date.now() - entry.at > PRUNE_GRACE_MS) {
      await cache.delete(request);
      ownerByWorker.delete(id);
    }
  }
}

async function ownerOf(workerId) {
  if (!ownerByWorker.has(workerId)) {
    const cache = await caches.open(OWNERS_CACHE);
    const entry = await (await cache.match(ownerKey(workerId)))?.json();
    if (entry?.ownerId) {
      ownerByWorker.set(workerId, entry.ownerId);
    }
  }
  return ownerByWorker.get(workerId);
}

self.addEventListener("fetch", (event) => {
  // A worker's script request: clientId is its creator, resultingClientId the new worker
  if (event.request.destination === "worker" && event.clientId && event.resultingClientId) {
    ownerByWorker.set(event.resultingClientId, event.clientId);
    event.waitUntil(rememberOwner(event.resultingClientId, event.clientId).catch(() => {}));
  }
});

/** The window that made a request, directly or through workers it created; undefined if unknown. */
self.lichtblickOwningWindow = async (clientId) => {
  let id = clientId;
  for (let depth = 0; id && depth < 8; depth++) {
    const client = await self.clients.get(id);
    if (client?.type === "window") {
      return client;
    }
    id = await ownerOf(id).catch(() => undefined);
  }
  return undefined;
};
