/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook, waitFor } from "@testing-library/react";

import useIndexedDbRecents from "@lichtblick/suite-base/hooks/useIndexedDbRecents";

const store = vi.hoisted(() => ({
  get: vi.fn(async () => {
    throw new Error("read failed");
  }),
  set: vi.fn(async () => {}),
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
