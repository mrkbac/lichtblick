/** @vitest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";

import { useAsync, useAsyncFn } from "./useAsyncFn";

describe("useAsyncFn", () => {
  it("only applies the result of the latest call", async () => {
    const resolvers: ((value: number) => void)[] = [];
    const { result } = renderHook(() =>
      useAsyncFn(async () => await new Promise<number>((resolve) => resolvers.push(resolve))),
    );
    let first!: Promise<number>;
    let second!: Promise<number>;
    act(() => {
      first = result.current[1]();
      second = result.current[1]();
    });
    expect(result.current[0].loading).toBe(true);
    await act(async () => {
      resolvers[1]!(2);
      await second;
      resolvers[0]!(1);
      await first;
    });
    expect(result.current[0]).toEqual({ value: 2, loading: false });
  });

  it("resolves with the error and stores it", async () => {
    const error = new Error("boom");
    const { result } = renderHook(() => useAsyncFn(async () => await Promise.reject(error)));
    let returned: unknown;
    await act(async () => {
      returned = await result.current[1]();
    });
    expect(returned).toBe(error);
    expect(result.current[0]).toEqual({ error, loading: false });
  });

  it("stores a non-Error rejection as an Error", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const { result } = renderHook(() => useAsyncFn(async () => await Promise.reject("boom")));
    await act(async () => {
      await result.current[1]();
    });
    expect(result.current[0].error?.message).toBe("boom");
  });
});

describe("useAsync", () => {
  it("runs on mount and does not update after unmount", async () => {
    let resolve!: (value: string) => void;
    const { result, unmount } = renderHook(() =>
      useAsync(async () => await new Promise<string>((r) => (resolve = r))),
    );
    expect(result.current.loading).toBe(true);
    unmount();
    await act(async () => {
      resolve("done");
    });
    expect(result.current.loading).toBe(true);
  });
});
