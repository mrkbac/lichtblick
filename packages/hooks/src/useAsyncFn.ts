// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

import { useMountedState } from "./useMountedState";

export type AsyncState<T> =
  | { loading: boolean; error?: undefined; value?: undefined }
  | { loading: true; error?: Error; value?: T }
  | { loading: false; error: Error; value?: undefined }
  | { loading: false; error?: undefined; value: T };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncFn = (...args: any[]) => Promise<any>;

/**
 * Wraps an async function and tracks its state. Only the latest call updates state, and nothing
 * updates after unmount. A rejection resolves the returned promise with the error.
 */
export function useAsyncFn<T extends AsyncFn>(
  fn: T,
  deps: DependencyList = [],
  initialState: AsyncState<Awaited<ReturnType<T>>> = { loading: false },
): [AsyncState<Awaited<ReturnType<T>>>, T] {
  const lastCallId = useRef(0);
  const isMounted = useMountedState();
  const [state, setState] = useState(initialState);

  const callback = useCallback(
    (async (...args: Parameters<T>) => {
      const callId = ++lastCallId.current;
      if (!state.loading) {
        setState((prev) => ({ ...prev, loading: true }));
      }
      return await fn(...args).then(
        (value: Awaited<ReturnType<T>>) => {
          if (isMounted() && callId === lastCallId.current) {
            setState({ value, loading: false });
          }
          return value;
        },
        (error: unknown) => {
          if (isMounted() && callId === lastCallId.current) {
            setState({
              error: error instanceof Error ? error : new Error(String(error)),
              loading: false,
            });
          }
          return error;
        },
      );
    }) as T,
    // Caller-supplied deps, like useCallback; fn and state are read from the latest render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  return [state, callback];
}

/** Runs an async function whenever deps change and tracks its state. */
export function useAsync<T extends AsyncFn>(
  fn: T,
  deps: DependencyList = [],
): AsyncState<Awaited<ReturnType<T>>> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [state, callback] = useAsyncFn(fn, deps, { loading: true });
  useEffect(() => {
    void callback();
  }, [callback]);
  return state;
}
