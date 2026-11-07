// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useMemo, useSyncExternalStore } from "react";

import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

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
  const installed =
    isDesktopApp() ||
    window.matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay)")
      .matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return useMemo(
    () =>
      event && !installed
        ? () => {
            // the event can only prompt once; the browser fires a new one if the user dismisses it
            setDeferredPrompt(undefined);
            // Keep the installability event as the gate, including on browsers with Web Install.
            const browser = navigator as Navigator & { install?: () => Promise<unknown> };
            const prompt =
              typeof browser.install === "function" ? browser.install() : event.prompt();
            void prompt.catch((error: unknown) => {
              if (!(error instanceof DOMException && error.name === "AbortError")) {
                console.error("App installation failed", error);
              }
            });
          }
        : undefined,
    [event, installed],
  );
}
