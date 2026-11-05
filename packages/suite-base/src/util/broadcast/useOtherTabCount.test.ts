/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook, waitFor } from "@testing-library/react";

import MockBroadcastChannel from "./MockBroadcastChannel";
import { useOtherTabCount } from "./useOtherTabCount";

/** Fake LockManager shared by every hook instance, like one browser origin. */
class FakeLocks {
  public held = new Set<string>();

  public async request(name: string, callback: () => Promise<void>): Promise<void> {
    this.held.add(name);
    try {
      await callback();
    } finally {
      this.held.delete(name);
    }
  }

  public async query(): Promise<{ held: { name: string }[] }> {
    return { held: [...this.held, "unrelated-lock"].map((name) => ({ name })) };
  }
}

describe("useOtherTabCount", () => {
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

  beforeEach(() => {
    (global as any).BroadcastChannel = MockBroadcastChannel;
  });

  afterEach(() => {
    if (originalLocks) {
      Object.defineProperty(navigator, "locks", originalLocks);
    } else {
      delete (navigator as any).locks;
    }
  });

  it("counts other tabs holding a tab lock", async () => {
    const locks = new FakeLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });

    const first = renderHook(() => useOtherTabCount());
    await waitFor(() => {
      expect(first.result.current).toBe(0);
    });

    // A second mount in the same tab is not another tab.
    const second = renderHook(() => useOtherTabCount());
    await waitFor(() => {
      expect(locks.held.size).toBe(2);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(second.result.current).toBe(0);

    // Two mounts from another tab count once.
    locks.held.add("lichtblick-tab:other-tab:a");
    locks.held.add("lichtblick-tab:other-tab:b");
    const third = renderHook(() => useOtherTabCount());
    await waitFor(() => {
      expect(third.result.current).toBe(1);
    });

    second.unmount();
    await waitFor(() => {
      expect(locks.held.size).toBe(4);
    });
  });

  it("returns undefined without the Web Locks API", () => {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });

    const { result } = renderHook(() => useOtherTabCount());
    act(() => {});
    expect(result.current).toBeUndefined();
  });
});
