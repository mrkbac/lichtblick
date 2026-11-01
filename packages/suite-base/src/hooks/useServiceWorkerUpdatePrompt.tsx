// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button } from "@mui/material";
import { useSnackbar } from "notistack";
import { useEffect } from "react";

import Logger from "@lichtblick/log";

const log = Logger.getLogger(__filename);

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
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && container.controller) {
              prompt(worker);
            }
          });
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
