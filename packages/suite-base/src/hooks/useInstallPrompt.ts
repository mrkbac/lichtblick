// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useMemo, useSyncExternalStore } from "react";

// https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent (Chromium only)
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | undefined;
const listeners = new Set<() => void>();

const setDeferredPrompt = (event: BeforeInstallPromptEvent | undefined) => {
  deferredPrompt = event;
  listeners.forEach((listener) => {
    listener();
  });
};

// Registered at import time: the browser fires this once, possibly before any component mounts.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // keep the browser's own mini-infobar from showing; we offer it in the menu
    setDeferredPrompt(event as BeforeInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => {
    setDeferredPrompt(undefined);
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Returns a function that shows the browser's "Install app" dialog, or undefined when the app
 * can't be installed right now (already installed, unsupported browser, desktop app).
 */
export function useInstallPrompt(): (() => void) | undefined {
  const event = useSyncExternalStore(subscribe, () => deferredPrompt);
  return useMemo(
    () =>
      event
        ? () => {
            // the event can only prompt once; the browser fires a new one if the user dismisses it
            setDeferredPrompt(undefined);
            void event.prompt();
          }
        : undefined,
    [event],
  );
}
