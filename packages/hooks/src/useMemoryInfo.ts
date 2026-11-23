// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";

import Logger from "@lichtblick/log";

const log = Logger.getLogger(__filename);

/** Chrome-only `performance.memory`, in bytes. */
export type MemoryInfo = {
  /** Maximum heap size */
  jsHeapSizeLimit: number;
  /** Current JS heap size, including free space not occupied by any JS objects */
  totalJSHeapSize: number;
  /** Memory used by JS objects, including V8 internal objects */
  usedJSHeapSize: number;
};

const readMemoryInfo = (): MemoryInfo | undefined =>
  (window.performance as { memory?: MemoryInfo }).memory;

export function useMemoryInfo(refreshIntervalMs: number): MemoryInfo | undefined {
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo | undefined>(readMemoryInfo);

  useEffect(() => {
    if (!readMemoryInfo()) {
      log.info("No memory information available");
      return;
    }

    const interval = setInterval(() => {
      setMemoryInfo(readMemoryInfo());
    }, refreshIntervalMs);
    return () => {
      clearInterval(interval);
    };
  }, [refreshIntervalMs]);

  return memoryInfo;
}
