// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { prepareTailscaleTransport, useTailscaleAccount } from "./TailscaleAccount";
import type { SessionStatus } from "./worker";

const { dispose, refreshPeers, callbacks } = vi.hoisted(() => ({
  dispose: vi.fn(),
  refreshPeers: vi.fn(),
  callbacks: [] as ((status: SessionStatus) => void)[],
}));
vi.mock("./TailscaleBackend", () => ({
  TailscaleBackend: class {
    public dispose = dispose;
    public refreshPeers = refreshPeers;
    public constructor(notify: (status: SessionStatus) => void) {
      callbacks.push(notify);
    }
  },
}));
vi.mock("@lichtblick/suite-base/i18n", () => ({ sharedI18nObject: { t: (key: string) => key } }));

beforeEach(() => {
  dispose.mockClear();
  callbacks.length = 0;
});

it("reopens a saved device when its browser identity becomes ready", async () => {
  const pending = prepareTailscaleTransport(new AbortController().signal);
  callbacks[0]!({ state: "Running", peers: [] });
  const backend = await pending;
  expect(backend.dispose).toBe(dispose);
  callbacks[0]!({ state: "NeedsLogin", peers: [] });
  expect(dispose).not.toHaveBeenCalled();
});

it("releases a cancelled connection while the shared node starts", async () => {
  const controller = new AbortController();
  const pending = prepareTailscaleTransport(controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  callbacks[0]!({ state: "Running", peers: [] });
  expect(dispose).toHaveBeenCalledOnce();
});

it("directs a signed-out recent connection to the profile menu", async () => {
  const pending = prepareTailscaleTransport(new AbortController().signal);
  callbacks[0]!({ state: "NeedsLogin", peers: [] });
  await expect(pending).rejects.toThrow("tailscaleProfileLogin");
  expect(dispose).toHaveBeenCalledOnce();
});

it("refreshes presence only while the device list is visible", () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const { result, unmount } = renderHook(() => useTailscaleAccount({ watchPeers: true }));
  try {
    act(() => {
      result.current.start();
    });
    act(() => {
      callbacks[0]!({ state: "Running", peers: [] });
    });
    expect(refreshPeers).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(true);
    vi.advanceTimersByTime(15000);
    expect(refreshPeers).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(15000);
    expect(refreshPeers).toHaveBeenCalledTimes(3);
    unmount();
    vi.advanceTimersByTime(15000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshPeers).toHaveBeenCalledTimes(3);
  } finally {
    hidden.mockRestore();
    vi.useRealTimers();
  }
});
