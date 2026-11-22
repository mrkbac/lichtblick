// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import Logger from "@lichtblick/log";
import type { PlayerState } from "@lichtblick/suite-base/players/types";

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
/** Set when another window switched this page's service worker to a newer build. */
let controllerChangedElsewhere = false;
/** One update at a time: repeated clicks must not run several saves. */
let updateInFlight = false;

/**
 * Saves the session and returns the playerSourceKey of the recording to resume, if it was playing.
 */
type SaveSession = () => Promise<string | undefined>;

let saveSession: SaveSession | undefined;
/** What the next reload resumes; stored only right before it (see reloadPage) */
let pendingResumeSource: string | undefined;

/**
 * The workspace registers how to save what a reload would otherwise lose (see
 * useSaveSessionBeforeReload). Every update reload awaits it first. Returns the unregister function.
 */
export function setSaveSessionBeforeReload(save: SaveSession): () => void {
  saveSession = save;
  return () => {
    if (saveSession === save) {
      saveSession = undefined;
    }
  };
}

async function saveSessionBeforeReload(): Promise<void> {
  try {
    pendingResumeSource = await saveSession?.();
  } catch (error: unknown) {
    log.warn("Saving the session before reload failed", error);
  }
}

/**
 * Every reload of this module goes through here. The resume key is written only now, when the
 * reload is certain: an activation that never happens must not make a later manual reload play.
 */
function reloadPage(): void {
  rememberPlaybackForReload(pendingResumeSource);
  window.location.reload();
}

const RESUME_PLAYBACK_KEY = "lichtblick.resumePlaybackAfterReload";

/**
 * Identifies the recording a player plays, across a reload (the player id is new each load).
 * Undefined while the player has no source.
 * ponytail: source type + player name (the file names, or the URL's), so a different file with the
 * same name would resume too. Players report no size or mtime; add one to PlayerState if that bites.
 */
export function playerSourceKey(
  playerState: Pick<PlayerState, "urlState" | "name">,
): string | undefined {
  const sourceId = playerState.urlState?.sourceId;
  return sourceId == undefined ? undefined : JSON.stringify([sourceId, playerState.name ?? ""]);
}

/**
 * Per tab: the reload that follows resumes playback of `source` (a playerSourceKey), see
 * takeResumePlayback. Undefined when it was not playing.
 */
export function rememberPlaybackForReload(source: string | undefined): void {
  try {
    if (source != undefined) {
      sessionStorage.setItem(RESUME_PLAYBACK_KEY, source);
    } else {
      sessionStorage.removeItem(RESUME_PLAYBACK_KEY);
    }
  } catch (error: unknown) {
    log.warn("Unable to store playback state", error);
  }
}

/**
 * The playerSourceKey of the recording that was playing when this tab reloaded for an update, so
 * only that recording resumes. Reads it only once.
 */
export function takeResumePlayback(): string | undefined {
  try {
    const source = sessionStorage.getItem(RESUME_PLAYBACK_KEY) ?? undefined;
    sessionStorage.removeItem(RESUME_PLAYBACK_KEY);
    return source;
  } catch {
    return undefined;
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
      reloadPage();
    } else if (worker.state === "redundant") {
      // It never activated: forget the request, so a later update by another window doesn't
      // reload this one unasked (or resume playback the user paused meanwhile)
      updateRequestedHere = false;
      pendingResumeSource = undefined;
      updateInFlight = false;
    }
  });
  worker.postMessage({ type: "SKIP_WAITING" });
}

const STALE_RELOAD_KEY = "staleChunkReloadAt";
const STALE_RELOAD_COOLDOWN_MS = 30_000;

/**
 * A lazy chunk failed to load, most likely because a newer deploy replaced this build's files.
 * Switch to the newest version: activate the updated service worker if there is one (that reloads
 * this window), else reload. Does nothing if it already tried recently, so a chunk that fails for
 * another reason (offline, still missing after the reload) can't cause a reload loop.
 * Returns whether it started a reload.
 */
export async function reloadToLatestVersion(): Promise<boolean> {
  const lastAttempt = Number(sessionStorage.getItem(STALE_RELOAD_KEY) ?? 0);
  if (updateInFlight || Date.now() - lastAttempt < STALE_RELOAD_COOLDOWN_MS) {
    return false;
  }
  sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()));
  updateInFlight = true;
  await saveSessionBeforeReload();

  const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  const hasUpdate = await checkForServiceWorkerUpdate().catch((error: unknown) => {
    log.warn("Service worker update check failed", error);
    return false;
  });
  const waiting = hasUpdate
    ? (await container?.getRegistration().catch(() => undefined))?.waiting
    : undefined;
  if (container && waiting) {
    container.addEventListener("controllerchange", () => {
      // not if the worker went redundant meanwhile and another window updated later
      if (updateRequestedHere) {
        reloadPage();
      }
    });
    applyServiceWorkerUpdate(waiting);
  } else {
    reloadPage();
  }
  return true;
}

/** Same literal in the service worker's runtime cache plugin (rspackConfigs.ts). */
const MISSING_ASSET_MESSAGE = "lichtblick.missingAsset";

type MissingAssetMessage = { type: typeof MISSING_ASSET_MESSAGE; url: string; direct: boolean };

function isMissingAssetMessage(data: unknown): data is MissingAssetMessage {
  return (
    typeof data === "object" &&
    data != undefined &&
    "type" in data &&
    data.type === MISSING_ASSET_MESSAGE &&
    "direct" in data &&
    typeof data.direct === "boolean"
  );
}

/**
 * A window left on an older build keeps running until the user updates it, but a file it loads
 * later (a lazy chunk, a worker, a wasm module, a fetched asset) may be gone from the host. The
 * service worker sees every such request and reports a missing file to the window that asked, or
 * that created the worker that asked (`direct`; sw-worker-owners.js). Switch to the latest version
 * then (the session is saved first). Only when it can't tell the owner (a worker created before
 * this service worker version) does it report to every window, and then every window known to be stale switches; a
 * window on the current build is never interrupted.
 * The script `error` listener in suite-web's index.tsx covers pages without a service worker.
 */
export function recoverFromMissingAssets(): void {
  const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (!container) {
    return;
  }
  container.addEventListener("controllerchange", () => {
    if (!updateRequestedHere) {
      controllerChangedElsewhere = true;
    }
  });
  container.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as unknown;
    if (isMissingAssetMessage(data) && (data.direct || controllerChangedElsewhere)) {
      log.warn("A file of this build is gone, switching to the latest version", data.url);
      void reloadToLatestVersion();
    }
  });
  // messages sent before the listener existed are queued until this
  container.startMessages();
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
  // another window may have updated before this mounted (or before a remount)
  const [activatedElsewhere, setActivatedElsewhere] = useState(() => controllerChangedElsewhere);

  useEffect(() => {
    const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (!container) {
      return;
    }

    let reloading = false;
    const onControllerChange = () => {
      if (!updateRequestedHere) {
        controllerChangedElsewhere = true;
        setWaiting(undefined);
        setActivatedElsewhere(true);
      } else if (!reloading) {
        reloading = true;
        reloadPage();
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

  // A newer version may be waiting even in a window that another window already updated:
  // updating applies the newest one, so it never lands on the intermediate build
  if (waiting) {
    return {
      kind: "waiting",
      update: () => {
        startUpdate(waiting);
      },
    };
  }
  return activatedElsewhere
    ? {
        kind: "activated",
        update: () => {
          startUpdate(undefined);
        },
      }
    : undefined;
}

/**
 * Saves the session, then switches this window to the newest version: activates the waiting worker
 * (`candidate`, or whatever waits by then) or, when none waits, reloads into the active one.
 */
function startUpdate(candidate: ServiceWorker | undefined): void {
  if (updateInFlight) {
    return;
  }
  updateInFlight = true;
  void saveSessionBeforeReload()
    .then(async () => {
      // A newer deploy may have replaced the candidate during the save, or another window
      // activated it (SKIP_WAITING would then change nothing, so no controllerchange would reload
      // this one): take whatever waits now
      let worker: ServiceWorker | null | undefined = candidate;
      if (worker?.state !== "installed") {
        worker = (await navigator.serviceWorker.getRegistration())?.waiting;
      }
      if (worker?.state === "installed") {
        applyServiceWorkerUpdate(worker);
      } else {
        reloadPage();
      }
    })
    .catch((error: unknown) => {
      // e.g. the registration lookup failed: let the user try again
      log.warn("Update failed", error);
      updateInFlight = false;
    });
}

/** Tests only: module state outlives a test. */
export function resetServiceWorkerUpdateStateForTests(): void {
  updateRequestedHere = false;
  controllerChangedElsewhere = false;
  updateInFlight = false;
  pendingResumeSource = undefined;
}
