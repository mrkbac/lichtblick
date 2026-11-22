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
  // `active` (not this page's `controller`, null after a force refresh) tells an update from a first install
  return registration.waiting != undefined && registration.active != undefined;
}

/** Set when this window asked for the update; only then does controllerchange reload it. */
let updateRequestedHere = false;

let saveSession: (() => Promise<void>) | undefined;

/**
 * The workspace registers how to save what a reload would otherwise lose (see
 * useSaveSessionBeforeReload). Every update reload awaits it first. Returns the unregister function.
 */
export function setSaveSessionBeforeReload(save: () => Promise<void>): () => void {
  saveSession = save;
  return () => {
    if (saveSession === save) {
      saveSession = undefined;
    }
  };
}

async function saveSessionBeforeReload(): Promise<void> {
  try {
    await saveSession?.();
  } catch (error: unknown) {
    log.warn("Saving the session before reload failed", error);
  }
}

const RESUME_PLAYBACK_KEY = "lichtblick.resumePlaybackAfterReload";

/** Per tab: the reload that follows resumes playback (see takeResumePlayback). */
export function rememberPlaybackForReload({ playing }: { playing: boolean }): void {
  try {
    if (playing) {
      sessionStorage.setItem(RESUME_PLAYBACK_KEY, "1");
    } else {
      sessionStorage.removeItem(RESUME_PLAYBACK_KEY);
    }
  } catch (error: unknown) {
    log.warn("Unable to store playback state", error);
  }
}

/** Whether the recording was playing when this tab reloaded for an update. Reads it only once. */
export function takeResumePlayback(): boolean {
  try {
    const playing = sessionStorage.getItem(RESUME_PLAYBACK_KEY) != undefined;
    sessionStorage.removeItem(RESUME_PLAYBACK_KEY);
    return playing;
  } catch {
    return false;
  }
}

/**
 * Activate a waiting worker. This window reloads on controllerchange (see below); a
 * force-refreshed window has no controller, so it reloads itself once the worker is active.
 * Other open windows are not reloaded: they show the update button and reload when clicked.
 */
export function applyServiceWorkerUpdate(worker: ServiceWorker): void {
  updateRequestedHere = true;
  worker.addEventListener("statechange", () => {
    if (worker.state === "activated" && !navigator.serviceWorker.controller) {
      window.location.reload();
    }
  });
  worker.postMessage({ type: "SKIP_WAITING" });
}

const STALE_RELOAD_KEY = "staleChunkReloadAt";
const STALE_RELOAD_COOLDOWN_MS = 30_000;

/**
 * A lazy chunk failed to load, most likely because a newer deploy replaced this build's files.
 * Switch to the newest version: activate the updated service worker if there is one (that reloads
 * every window), else reload. Does nothing if it already tried recently, so a chunk that fails for
 * another reason (offline, still missing after the reload) can't cause a reload loop.
 * Returns whether it started a reload.
 */
export async function reloadToLatestVersion(): Promise<boolean> {
  const lastAttempt = Number(sessionStorage.getItem(STALE_RELOAD_KEY) ?? 0);
  if (Date.now() - lastAttempt < STALE_RELOAD_COOLDOWN_MS) {
    return false;
  }
  sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()));
  await saveSessionBeforeReload();

  const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  const hasUpdate = await checkForServiceWorkerUpdate().catch((error: unknown) => {
    log.warn("Service worker update check failed", error);
    return false;
  });
  const waiting = hasUpdate ? (await container?.getRegistration())?.waiting : undefined;
  if (container && waiting) {
    container.addEventListener("controllerchange", () => {
      window.location.reload();
    });
    applyServiceWorkerUpdate(waiting);
  } else {
    window.location.reload();
  }
  return true;
}

export type ServiceWorkerUpdate = {
  /**
   * "waiting": a new version is downloaded; updating activates it and reloads this window.
   * "activated": another window already switched to it; this one still runs the old build and
   * updating just reloads it.
   */
  kind: "waiting" | "activated";
  update: () => void;
};

/**
 * Returns the available update, or undefined while there is none. Never updates on its own, so the
 * user is never interrupted: other windows keep running the old build until the user clicks there.
 * (A lazy chunk the new deploy removed reloads a window earlier, see reloadToLatestVersion.)
 * Before reloading it saves the session (setSaveSessionBeforeReload); the reload restores it:
 * layout (local storage), data source and time (URL), the open file (session storage, see
 * PlayerManager) and whether it was playing (takeResumePlayback).
 * No-op where no service worker is registered (desktop, dev server).
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdate | undefined {
  const [waiting, setWaiting] = useState<ServiceWorker | undefined>();
  const [activatedElsewhere, setActivatedElsewhere] = useState(false);

  useEffect(() => {
    const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (!container) {
      return;
    }

    let reloading = false;
    const onControllerChange = () => {
      if (!updateRequestedHere) {
        setWaiting(undefined);
        setActivatedElsewhere(true);
      } else if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    };
    container.addEventListener("controllerchange", onControllerChange);

    let registration: ServiceWorkerRegistration | undefined;
    // no `active` worker means the very first install, which is not an update
    const check = () => {
      if (registration?.waiting && registration.active) {
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

  if (activatedElsewhere) {
    return {
      kind: "activated",
      update: () => {
        void saveSessionBeforeReload().then(() => {
          window.location.reload();
        });
      },
    };
  }
  return waiting
    ? {
        kind: "waiting",
        update: () => {
          void saveSessionBeforeReload().then(() => {
            applyServiceWorkerUpdate(waiting);
          });
        },
      }
    : undefined;
}
