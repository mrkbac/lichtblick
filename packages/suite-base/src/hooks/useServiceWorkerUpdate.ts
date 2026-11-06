// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import Logger from "@lichtblick/log";

const log = Logger.getLogger(__filename);

/**
 * Ask the browser to fetch the service worker now instead of waiting for its periodic check.
 * Only downloads the update: it is applied when the user clicks the update button in the app bar.
 * Resolves false when no update is available; rejects when the update fails to install.
 */
export async function checkForServiceWorkerUpdate(): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    return false;
  }
  await registration.update();
  // update() resolves once the new script is fetched, before it has finished precaching
  const installing = registration.installing;
  if (installing) {
    await new Promise<void>((resolve, reject) => {
      const onStateChange = () => {
        if (installing.state === "installing") {
          return;
        }
        installing.removeEventListener("statechange", onStateChange);
        if (installing.state === "redundant") {
          reject(new Error("Service worker update failed to install"));
        } else {
          resolve();
        }
      };
      installing.addEventListener("statechange", onStateChange);
      onStateChange(); // it may have finished installing before the listener was attached
    });
  }
  return registration.waiting != undefined && navigator.serviceWorker.controller != undefined;
}

/**
 * Returns the installed-and-waiting new service worker, if any. Never applies it on its own:
 * post `{ type: "SKIP_WAITING" }` to it to update. Once it takes over, every open window reloads
 * (on controllerchange) because the old precache is deleted and lazy chunks would fail to load.
 * The reload restores the session: layout (local storage), data source and time (URL), and the
 * open file (session storage, see PlayerManager).
 * No-op where no service worker is registered (desktop, dev server).
 */
export function useServiceWorkerUpdate(): ServiceWorker | undefined {
  const [waiting, setWaiting] = useState<ServiceWorker | undefined>();

  useEffect(() => {
    const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (!container) {
      return;
    }

    let reloading = false;
    const onControllerChange = () => {
      if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    };
    container.addEventListener("controllerchange", onControllerChange);

    let registration: ServiceWorkerRegistration | undefined;
    // `controller` is null on the very first install, which is not an update
    const check = () => {
      if (registration?.waiting && container.controller) {
        setWaiting(registration.waiting);
      }
    };
    const watch = (worker: ServiceWorker | null) => {
      worker?.addEventListener("statechange", check);
    };
    const onUpdateFound = () => {
      watch(registration?.installing ?? null);
    };

    container
      .getRegistration()
      .then((reg) => {
        registration = reg;
        if (!reg) {
          return;
        }
        check();
        // an update may already be installing if updatefound fired before this lookup resolved
        watch(reg.installing);
        reg.addEventListener("updatefound", onUpdateFound);
      })
      .catch((error: unknown) => {
        log.warn("Service worker registration lookup failed", error);
      });

    return () => {
      container.removeEventListener("controllerchange", onControllerChange);
      registration?.removeEventListener("updatefound", onUpdateFound);
    };
  }, []);

  return waiting;
}
