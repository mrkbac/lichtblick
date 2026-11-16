// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import Logger from "@lichtblick/log";
import type { IDataSourceFactory } from "@lichtblick/suite-base";
import CssBaseline from "@lichtblick/suite-base/components/CssBaseline";
import { reloadToLatestVersion } from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";
import waitForFonts from "@lichtblick/suite-base/util/waitForFonts";

import { CompatibilityBanner } from "./CompatibilityBanner";
import { ASSET_LIST_FILE, type AssetList, HASHED_FILE, RUNTIME_CACHE_NAME } from "./assetCache";
import { canRenderApp } from "./canRenderApp";

const log = Logger.getLogger(__filename);

function LogAfterRender(props: React.PropsWithChildren): React.JSX.Element {
  useEffect(() => {
    // Integration tests look for this console log to indicate the app has rendered once
    // We use console.debug to bypass our logging library which hides some log levels in prod builds
    console.debug("App rendered");
  }, []);
  return <>{props.children}</>;
}

/**
 * An uncontrolled page (first visit, force refresh) loads its chunks past the service worker.
 * Copy them, and every chunk loaded later in this session, into the service worker's runtime
 * cache so the next start works offline. Observes from the start, so no entry is missed while the
 * service worker installs; the copies wait for it.
 */
function cacheLoadedAssets(): void {
  const cachePromise = navigator.serviceWorker.ready.then(
    async () => await caches.open(RUNTIME_CACHE_NAME),
  );
  // cacheAsset's own fetches show up as resource entries too; never cache a URL twice
  const seen = new Set<string>();
  new PerformanceObserver((list) => {
    const urls = list
      .getEntries()
      .map((entry) => entry.name)
      .filter((url) => {
        const { origin, pathname } = new URL(url);
        // same rule as the service worker's runtime cache route
        const cacheable = origin === location.origin && HASHED_FILE.test(pathname);
        if (!cacheable || seen.has(url)) {
          return false;
        }
        seen.add(url);
        return true;
      });
    for (const url of urls) {
      // each file on its own, so one failure doesn't drop the others. A failed file stays in
      // `seen` (its own fetch shows up as a new entry); the next uncontrolled load retries it.
      void cacheAsset(cachePromise, url);
    }
  }).observe({ type: "resource", buffered: true });
}

async function cacheAsset(cachePromise: Promise<Cache>, url: string): Promise<void> {
  try {
    const cache = await cachePromise;
    // file names are content-hashed, so the HTTP cache copy is always valid: no second download
    const response = await fetch(url, { cache: "force-cache" });
    // same rule as the service worker: the host answers unknown paths with index.html
    if (response.ok && response.headers.get("content-type")?.startsWith("text/html") !== true) {
      await cache.put(url, response);
    }
  } catch (err: unknown) {
    log.warn("Caching loaded asset failed", url, err);
  }
}

/** Parallel downloads while filling the cache, so the app's own requests aren't starved */
const CACHE_ALL_CONCURRENCY = 4;

/**
 * The installed app works offline, so download every file of this build into the runtime cache
 * (a browser tab only caches what it loads). Drops cached files of other builds, which this version
 * never requests.
 */
async function cacheAllAssets(): Promise<void> {
  try {
    // build files sit next to sw.js; the page itself may be at a deep link
    const { scope } = await navigator.serviceWorker.ready;
    const response = await fetch(new URL(ASSET_LIST_FILE, scope), { cache: "no-store" });
    const assetList = (await response.json()) as AssetList;
    if (assetList.version !== LICHTBLICK_SUITE_VERSION) {
      // A newer build is deployed; it fills the cache once the update activates
      return;
    }
    const cache = await caches.open(RUNTIME_CACHE_NAME);
    const wanted = new Set(assetList.files.map((file) => new URL(file, scope).href));
    const cached = new Set<string>();
    for (const request of await cache.keys()) {
      if (wanted.has(request.url)) {
        cached.add(request.url);
      } else {
        await cache.delete(request);
      }
    }
    const missing = [...wanted].filter((url) => !cached.has(url));
    log.info(`Caching ${missing.length} of ${wanted.size} build files for offline use`);
    const cachePromise = Promise.resolve(cache);
    await Promise.all(
      Array.from({ length: CACHE_ALL_CONCURRENCY }, async () => {
        let url: string | undefined;
        while ((url = missing.pop()) != undefined) {
          await cacheAsset(cachePromise, url);
        }
      }),
    );
  } catch (err: unknown) {
    log.warn("Caching all build files failed", err);
  }
}

export type MainParams = {
  dataSources?: IDataSourceFactory[];
  extraProviders?: React.JSX.Element[];
  rootElement?: React.JSX.Element;
};

export async function main(getParams: () => Promise<MainParams> = async () => ({})): Promise<void> {
  log.debug("initializing");

  window.onerror = (...args) => {
    console.error(...args);
  };

  // A tab opened before a deploy still runs the old build; its lazy chunks are gone from the host
  // (which answers with index.html, blocked by nosniff). Every chunk import fails the same way, so
  // catch it here, once, instead of in each caller. Resource errors don't bubble: listen in capture.
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement && new URL(target.src).origin === location.origin) {
        log.warn("Script failed to load, switching to the latest version", target.src);
        void reloadToLatestVersion();
      }
    },
    true,
  );

  if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
    // Offline support for the installed PWA; sw.js is generated by workbox in rspackConfigs.ts
    navigator.serviceWorker.register("sw.js").catch((err: unknown) => {
      log.error("Service worker registration failed", err);
    });
    if (!navigator.serviceWorker.controller) {
      cacheLoadedAssets();
    }
    if (matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay)").matches) {
      void cacheAllAssets();
    }
    // Keep the offline cache from being evicted under storage pressure
    void navigator.storage.persist();
  }

  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("missing #root element");
  }

  const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)\./);
  const chromeVersion = chromeMatch ? parseInt(chromeMatch[1] ?? "", 10) : 0;
  const isChrome = chromeVersion !== 0;

  const canRender = canRenderApp();
  const banner = (
    <CompatibilityBanner
      isChrome={isChrome}
      currentVersion={chromeVersion}
      isDismissable={canRender}
    />
  );

  if (!canRender) {
    const root = createRoot(rootEl);
    root.render(
      <LogAfterRender>
        <CssBaseline>{banner}</CssBaseline>
      </LogAfterRender>,
    );
    return;
  }

  // Async imports delay loading the majority of suite-base code until the CompatibilityBanner can be
  // displayed. Start both at once instead of one after another.
  // Chunk names: the startup budget in rspackConfigs.ts measures these.
  const webRootPromise = import(/* webpackChunkName: "startup-webroot" */ "./WebRoot");
  // CssBaseline (imported above) declared the font faces; download them while the JS loads
  const fontsPromise = waitForFonts();
  const { installDevtoolsFormatters, overwriteFetch, initI18n, StudioApp, completeLoginRedirect } =
    await import(/* webpackChunkName: "startup-app" */ "@lichtblick/suite-base");
  installDevtoolsFormatters();
  overwriteFetch();
  // Before anything reads the URL: a login redirect carries a code and restores the original URL.
  await completeLoginRedirect().catch((error: unknown) => {
    log.error("Login failed", error);
  });
  // consider moving waitForFonts into App to display an app loading screen
  await Promise.all([fontsPromise, initI18n()]);

  const [{ WebRoot }, params] = await Promise.all([webRootPromise, getParams()]);
  const rootElement = params.rootElement ?? (
    <WebRoot extraProviders={params.extraProviders} dataSources={params.dataSources}>
      <StudioApp />
    </WebRoot>
  );

  const root = createRoot(rootEl);
  root.render(
    <LogAfterRender>
      {banner}
      {rootElement}
    </LogAfterRender>,
  );
}
