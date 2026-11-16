// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef } from "react";

/** Returns a stable getter that is true between mount and unmount (tracked in useEffect). */
export function useMountedState(): () => boolean {
  const mountedRef = useRef(false);
  const get = useCallback(() => mountedRef.current, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return get;
}
