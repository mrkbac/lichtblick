/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import {
  recoverFromMissingAssets,
  resetServiceWorkerUpdateStateForTests,
} from "./useServiceWorkerUpdate";

describe("recoverFromMissingAssets", () => {
  const reload = vi.fn();
  let messagesStarted = false;
  const container = Object.assign(new EventTarget(), {
    controller: {},
    getRegistration: async () => undefined,
    startMessages: () => {
      messagesStarted = true;
    },
  });
  const missing = ({ direct }: { direct: boolean }) => {
    sessionStorage.clear(); // the reload cooldown
    container.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "lichtblick.missingAsset",
          url: "http://localhost/a.0123456789abcdef.js",
          direct,
        },
      }),
    );
  };

  beforeAll(() => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
    Object.defineProperty(window, "location", { configurable: true, value: { reload } });
    recoverFromMissingAssets();
  });
  beforeEach(() => {
    reload.mockClear();
    // the mocked reload never ends the page, so the last switch stays in flight
    resetServiceWorkerUpdateStateForTests();
  });
  afterEach(() => {
    // it logs which file was missing
    (console.warn as Mock).mockClear();
  });

  it("starts the message queue", () => {
    expect(messagesStarted).toBe(true);
  });

  it("switches the window whose own request found a file missing", async () => {
    missing({ direct: true });
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores a broadcast while this window runs the current build", async () => {
    missing({ direct: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reload).not.toHaveBeenCalled();
  });

  it("switches on a broadcast once another window updated", async () => {
    container.dispatchEvent(new Event("controllerchange"));
    missing({ direct: false });
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
