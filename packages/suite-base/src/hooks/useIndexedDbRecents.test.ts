/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, renderHook, waitFor } from "@testing-library/react";

import useIndexedDbRecents, { MAX_RECENTS } from "@lichtblick/suite-base/hooks/useIndexedDbRecents";

const connection = (url: string) => ({
  type: "connection" as const,
  sourceId: "foxglove-websocket",
  title: url,
  extra: { url },
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useIndexedDbRecents", () => {
  it("empty recents on mount", () => {
    const { result, unmount } = renderHook(() => useIndexedDbRecents());
    expect(result.current.recents).toEqual([]);
    unmount();
  });

  it("adding a recent immediately should save it", async () => {
    // The first hook is used to addRecent immediately. This happens before the database recents have loaded
    {
      const { result, unmount } = renderHook(() => useIndexedDbRecents());
      expect(result.current.recents).toEqual([]);

      act(() => {
        result.current.addRecent({
          sourceId: "foo",
          title: "my-title",
          type: "connection",
          extra: {
            foo: "bar",
          },
        });
      });

      // The hook saves once its initial load finishes; wait for that, then for the write to commit
      // (fake-indexeddb completes requests on macrotasks)
      await waitFor(() => {
        expect(result.current.recents).toHaveLength(1);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      unmount();
    }

    // This hooks should be able to load the recent added above before recents were loaded
    {
      const { result, unmount } = renderHook(() => useIndexedDbRecents());
      expect(result.current.recents).toEqual([]);

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.recents).toEqual([
        {
          id: expect.any(String),
          lastOpened: expect.any(Number),
          sourceId: "foo",
          title: "my-title",
          type: "connection",
          extra: {
            foo: "bar",
          },
        },
      ]);

      unmount();
    }
  });

  it("moves a re-opened recent to the top, keeping its id and pin", async () => {
    const { result, unmount } = renderHook(() => useIndexedDbRecents());
    await flush();
    act(() => {
      result.current.clearRecents();
    });

    let firstId = "";
    act(() => {
      firstId = result.current.addRecent(connection("ws://a"));
      result.current.addRecent(connection("ws://b"));
    });
    act(() => {
      result.current.togglePinRecent(firstId);
    });
    act(() => {
      result.current.addRecent(connection("ws://a"));
    });

    expect(result.current.recents.map((r) => [r.title, r.pinned === true])).toEqual([
      ["ws://a", true],
      ["ws://b", false],
    ]);
    expect(result.current.recents[0]?.id).toBe(firstId);

    act(() => {
      result.current.clearRecents();
    });
    expect(result.current.recents.map((r) => r.title)).toEqual(["ws://a"]);

    act(() => {
      result.current.removeRecent(firstId);
    });
    expect(result.current.recents).toEqual([]);
    unmount();
  });

  it("evicts unpinned recents beyond the limit", async () => {
    const { result, unmount } = renderHook(() => useIndexedDbRecents());
    await flush();
    act(() => {
      result.current.clearRecents();
    });

    act(() => {
      const pinnedId = result.current.addRecent(connection("ws://pinned"));
      result.current.togglePinRecent(pinnedId);
    });
    act(() => {
      for (let i = 0; i < MAX_RECENTS + 5; i++) {
        result.current.addRecent(connection(`ws://host-${i}`));
      }
    });

    expect(result.current.recents).toHaveLength(MAX_RECENTS + 1);
    expect(result.current.recents.some((r) => r.title === "ws://pinned")).toBe(true);
    expect(result.current.recents.some((r) => r.title === "ws://host-0")).toBe(false);
    unmount();
  });
});
