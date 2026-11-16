// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from "react";

import { useLatest } from "./useLatest";

/** Calls handler on every window keydown whose `key` matches. */
export function useKeyPressEvent(key: string, handler: (event: KeyboardEvent) => void): void {
  const handlerRef = useLatest(handler);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === key) {
        handlerRef.current(event);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [key, handlerRef]);
}
