// SPDX-License-Identifier: MPL-2.0

// Imported by the generated service worker (rspackConfigs.ts). Remembers which window created each
// worker, so a build file a worker can't load is reported to that window (fetchDidSucceed in
// rspackConfigs.ts, recoverFromMissingAssets in useServiceWorkerUpdate.ts).
// ponytail: in memory only. When the idle service worker stops, the map is lost and such a report
// falls back to every window that knows it is stale; persist it if that proves too coarse.
const ownerByWorker = new Map();
const MAX_WORKERS = 1000;

self.addEventListener("fetch", (event) => {
  // A worker's script request: clientId is its creator, resultingClientId the new worker
  if (event.request.destination === "worker" && event.clientId && event.resultingClientId) {
    ownerByWorker.set(event.resultingClientId, event.clientId);
    if (ownerByWorker.size > MAX_WORKERS) {
      ownerByWorker.delete(ownerByWorker.keys().next().value);
    }
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
    id = ownerByWorker.get(id);
  }
  return undefined;
};
