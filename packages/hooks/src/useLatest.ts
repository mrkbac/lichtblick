// SPDX-License-Identifier: MPL-2.0

import { useRef, type RefObject } from "react";

/** Ref that always holds the value from the latest render. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
