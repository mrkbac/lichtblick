// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Returns a stable getter that is true between mount and unmount. Tracked in useLayoutEffect so
 * it is already accurate inside the component's own layout effects.
 */
export function useMountedState(): () => boolean {
  const mountedRef = useRef(false);
  const get = useCallback(() => mountedRef.current, []);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return get;
}
