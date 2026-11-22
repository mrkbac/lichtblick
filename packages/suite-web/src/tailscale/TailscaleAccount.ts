// SPDX-License-Identifier: MPL-2.0

import { useSyncExternalStore } from "react";

import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { TailscaleBackend } from "./TailscaleBackend";
import type { SessionStatus } from "./worker";

let status: SessionStatus | undefined;
let account: TailscaleBackend | undefined;
const listeners = new Set<() => void>();

function update(next: SessionStatus) {
  status = next;
  if (next.state === "LoggedOut") {
    account?.dispose();
    account = undefined;
  }
  for (const listener of listeners) {
    listener();
  }
}

function start() {
  if (account && !status?.error) {
    return;
  }
  account?.dispose();
  try {
    account = new TailscaleBackend(update);
    update({ state: "Starting", peers: [] });
  } catch {
    account = undefined;
    update({ state: "Failed", error: "tailscaleFailed", peers: [] });
  }
}

function logout() {
  account?.logout();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getSnapshot = () => status;

export function useTailscaleAccount(): {
  status: SessionStatus | undefined;
  start: () => void;
  logout: () => void;
} {
  return { status: useSyncExternalStore(subscribe, getSnapshot), start, logout };
}

/** A player owns its port. Closing a source leaves the profile menu signed in. */
export async function prepareTailscaleTransport(signal: AbortSignal): Promise<TailscaleBackend> {
  signal.throwIfAborted();
  return await new Promise<TailscaleBackend>((resolve, reject) => {
    const backend = new TailscaleBackend((next) => {
      if (settled) {
        return;
      }
      if (next.state === "Running" && !next.error) {
        finish();
        resolve(backend);
      } else if (
        next.error ||
        next.state === "NeedsLogin" ||
        next.state === "LoggedOut" ||
        next.state === "NeedsMachineAuth"
      ) {
        fail(
          new Error(
            sharedI18nObject.t(
              next.error ? `openDialog:${next.error}` : "openDialog:tailscaleProfileLogin",
            ),
          ),
        );
      }
    });
    const abort = () => {
      fail(new Error("Connection cancelled"));
    };
    const timeout = setTimeout(() => {
      fail(new Error(sharedI18nObject.t("openDialog:tailscaleFailed")));
    }, 30000);
    signal.addEventListener("abort", abort, { once: true });
    let settled = false;
    function finish() {
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
    function fail(error: Error) {
      if (settled) {
        return;
      }
      finish();
      backend.dispose();
      reject(error);
    }
  });
}
