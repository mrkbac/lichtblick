/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import { checkForServiceWorkerUpdate } from "./useServiceWorkerUpdate";

type FakeWorker = EventTarget & { state: string; postMessage: Mock };

const fakeWorker = (state: string): FakeWorker =>
  Object.assign(new EventTarget(), { state, postMessage: vi.fn() });

// `update()` finds a new worker in `installing`, which then moves to `finalState`
function mockRegistration(finalState: string | undefined) {
  const registration = {
    active: fakeWorker("activated"),
    installing: undefined as FakeWorker | undefined,
    waiting: undefined as FakeWorker | undefined,
    update: vi.fn(async () => {
      if (finalState == undefined) {
        return;
      }
      const worker = fakeWorker("installing");
      registration.installing = worker;
      setTimeout(() => {
        worker.state = finalState;
        registration.installing = undefined;
        registration.waiting = finalState === "installed" ? worker : undefined;
        worker.dispatchEvent(new Event("statechange"));
      }, 0);
    }),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller: undefined, getRegistration: async () => registration },
  });
  return registration;
}

describe("checkForServiceWorkerUpdate", () => {
  it("resolves false when there is no update", async () => {
    mockRegistration(undefined);
    await expect(checkForServiceWorkerUpdate()).resolves.toBe(false);
  });

  it("downloads the update without applying it", async () => {
    const registration = mockRegistration("installed");
    await expect(checkForServiceWorkerUpdate()).resolves.toBe(true);
    expect(registration.waiting?.postMessage).not.toHaveBeenCalled();
  });

  it("rejects when the update fails to install", async () => {
    mockRegistration("redundant");
    await expect(checkForServiceWorkerUpdate()).rejects.toThrow("failed to install");
  });
});
