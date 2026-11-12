// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Imported by the generated service worker (rspackConfigs.ts). Foxglove-style view links
// (<scope>/<org>/view?…) use our query parameters, but the precached index.html loads its script
// by a relative path, which breaks under /<org>/. Redirect them to the app root with the same
// query before workbox serves the app shell. web/.cloudflare/_redirects does the same on the
// server for visits without an installed service worker.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") {
    return;
  }
  const scope = new URL(self.registration.scope);
  const url = new URL(event.request.url);
  if (
    url.origin === scope.origin &&
    url.pathname.startsWith(scope.pathname) &&
    /^[^/]+\/view\/?$/.test(url.pathname.slice(scope.pathname.length))
  ) {
    event.respondWith(Response.redirect(scope.href + url.search, 302));
  }
});
