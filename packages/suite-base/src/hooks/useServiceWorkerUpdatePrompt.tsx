// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button } from "@mui/material";
import { useSnackbar } from "notistack";
import { useEffect } from "react";

import Logger from "@lichtblick/log";

const log = Logger.getLogger(__filename);

/**
 * Ask the browser to fetch the service worker now instead of waiting for its periodic check,
 * and switch to a new version right away: the user explicitly asked for it, so unlike the
 * background update prompt this doesn't ask again before every window reloads.
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
  if (registration.waiting && navigator.serviceWorker.controller) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    return true;
  }
  return installing != undefined;
}

/**
 * When a new service worker version is installed and waiting, offer to reload into it.
 * The waiting worker is activated via the workbox SKIP_WAITING message; every open window
 * then reloads on controllerchange so no window keeps running against deleted precache chunks.
 * No-op where no service worker is registered (desktop, dev server).
 */
export function useServiceWorkerUpdatePrompt(): void {
  const { enqueueSnackbar } = useSnackbar();

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

    const prompt = (worker: ServiceWorker) => {
      enqueueSnackbar("A new version of Lichtblick is available.", {
        variant: "info",
        persist: true,
        preventDuplicate: true,
        action: (
          <Button
            color="inherit"
            onClick={() => {
              worker.postMessage({ type: "SKIP_WAITING" });
            }}
          >
            Reload
          </Button>
        ),
      });
    };

    container
      .getRegistration()
      .then((registration) => {
        if (!registration) {
          return;
        }
        // `controller` is null on the very first install, which is not an update
        if (registration.waiting && container.controller) {
          prompt(registration.waiting);
        }
        const watch = (worker: ServiceWorker | null) => {
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && container.controller) {
              prompt(worker);
            }
          });
        };
        // an update may already be installing if updatefound fired before this lookup resolved
        watch(registration.installing);
        registration.addEventListener("updatefound", () => {
          watch(registration.installing);
        });
      })
      .catch((error: unknown) => {
        log.warn("Service worker registration lookup failed", error);
      });

    return () => {
      container.removeEventListener("controllerchange", onControllerChange);
    };
  }, [enqueueSnackbar]);
}
