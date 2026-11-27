/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import sendNotification from "@lichtblick/suite-base/util/sendNotification";

import {
  checkForServiceWorkerUpdate,
  resetServiceWorkerUpdateStateForTests,
  setSaveSessionBeforeReload,
  reloadToLatestVersion,
  rememberPlaybackForReload,
  takeResumePlayback,
} from "./useServiceWorkerUpdate";

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

describe("reloadToLatestVersion", () => {
  const reload = vi.fn();
  beforeEach(() => {
    resetServiceWorkerUpdateStateForTests();
    sessionStorage.clear();
    reload.mockClear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload },
    });
  });

  it("activates the updated service worker instead of reloading into the old build", async () => {
    const registration = mockRegistration("installed");
    Object.assign(navigator.serviceWorker, { addEventListener: vi.fn() });
    await expect(reloadToLatestVersion()).resolves.toBe(true);
    expect(registration.waiting?.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled();
  });

  it("doesn't reload unasked when its worker went redundant and another window updated", async () => {
    const registration = mockRegistration("installed");
    const addEventListener = vi.fn();
    Object.assign(navigator.serviceWorker, { addEventListener });
    await reloadToLatestVersion();
    const onControllerChange = addEventListener.mock.calls.find(
      ([type]) => type === "controllerchange",
    )![1] as () => void;
    const worker = registration.waiting!;
    worker.state = "redundant";
    worker.dispatchEvent(new Event("statechange"));
    onControllerChange();
    expect(reload).not.toHaveBeenCalled();
  });

  it("waits for an update already in flight instead of starting a second save", async () => {
    mockRegistration(undefined);
    let finishSave = () => {};
    const save = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      return undefined;
    });
    const unregister = setSaveSessionBeforeReload(save);
    const first = reloadToLatestVersion();
    sessionStorage.clear(); // past the cooldown
    await expect(reloadToLatestVersion()).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    finishSave();
    await first;
    unregister();
  });

  it("reloads when there is no update", async () => {
    mockRegistration(undefined);
    await expect(reloadToLatestVersion()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("doesn't reload where storage is blocked, since the cooldown couldn't survive it", async () => {
    mockRegistration(undefined);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await expect(reloadToLatestVersion()).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    getItem.mockRestore();
  });

  it("tries only once per cooldown, so a persistent failure can't loop", async () => {
    mockRegistration(undefined);
    await reloadToLatestVersion();
    await expect(reloadToLatestVersion()).resolves.toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  describe("when the failed file can't be fetched", () => {
    const CHUNK = "https://app.example/chunk.abc123.js";
    let fetchMock: Mock;
    beforeEach(() => {
      fetchMock = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("shows an offline notice instead of reloading, and retries once online", async () => {
      mockRegistration(undefined);
      await expect(reloadToLatestVersion(CHUNK)).resolves.toBe(false);
      // Every later failure while offline (30 s apart or not) waits for the same retry
      sessionStorage.clear();
      await expect(reloadToLatestVersion(CHUNK)).resolves.toBe(false);
      expect(reload).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(CHUNK, { method: "HEAD", cache: "no-store" });
      sendNotification.expectCalledDuringTest();

      fetchMock.mockResolvedValue(new Response(undefined, { status: 200 }));
      window.dispatchEvent(new Event("online"));
      await vi.waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });

    it("doesn't fetch while the browser reports offline", async () => {
      mockRegistration(undefined);
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      await expect(reloadToLatestVersion(CHUNK)).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      sendNotification.expectCalledDuringTest();
      vi.restoreAllMocks();
    });
  });
});

describe("takeResumePlayback", () => {
  it("resumes only the reload right after a playing update", () => {
    rememberPlaybackForReload("source");
    expect(takeResumePlayback()).toBe("source");
    expect(takeResumePlayback()).toBeUndefined();
    rememberPlaybackForReload(undefined);
    expect(takeResumePlayback()).toBeUndefined();
  });
});
