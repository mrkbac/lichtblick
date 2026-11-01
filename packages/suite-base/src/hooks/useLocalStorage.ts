// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useState } from "react";

/**
 * JSON-backed localStorage value. Storage is read once on mount (not re-read in a layout effect),
 * so writes made between renders are not clobbered by a stale read.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [value: T, setValue: (value: T) => void, remove: () => void] {
  const [value, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != undefined ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });
  const setValue = useCallback(
    (newValue: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(newValue) ?? "null");
      } catch {
        // storage full or unavailable; keep the in-memory value
      }
      setState(newValue);
    },
    [key],
  );
  const remove = useCallback(() => {
    localStorage.removeItem(key);
    setState(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, setValue, remove];
}
