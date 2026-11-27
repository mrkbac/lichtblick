/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import useIndexedDbRecents from "@lichtblick/suite-base/hooks/useIndexedDbRecents";

const store = vi.hoisted(() => ({
  get: vi.fn(async () => {
    throw new Error("read failed");
  }),
  set: vi.fn(async () => {}),
  readwrite: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/util/idbKeyValueStore", () => ({
  createKeyValueStore: () => store,
}));

describe("useIndexedDbRecents when the stored recents can't be read", () => {
  it("keeps new recents in memory without overwriting the store", async () => {
    const { result } = renderHook(() => useIndexedDbRecents());
    act(() => {
      result.current.addRecent({ sourceId: "foo", title: "t", type: "connection", extra: {} });
    });

    await waitFor(() => {
      expect(result.current.recents).toHaveLength(1);
    });
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe("useIndexedDbRecents when a write aborts", () => {
  it("logs the failed write without an unhandled rejection from the aborted transaction", async () => {
    store.get.mockResolvedValueOnce(undefined as never);
    const abort = new DOMException("quota", "QuotaExceededError");
    store.readwrite.mockImplementation(async () => ({
      get: async () => {
        throw abort;
      },
      put: vi.fn(),
      transaction: { done: Promise.reject(abort) },
    }));
    const { result } = renderHook(() => useIndexedDbRecents());
    await waitFor(() => {
      expect(result.current.recentsLoaded).toBe(true);
    });
    await act(async () => {
      result.current.addRecent({ sourceId: "foo", title: "t", type: "connection", extra: {} });
      await result.current.save();
    });
    // vitest fails the run on an unhandled rejection; the change stays queued for the next save
    expect(result.current.recents).toHaveLength(1);
    expect(console.error).toHaveBeenCalled();
    (console.error as Mock).mockClear();
  });
});
