// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import EventEmitter from "eventemitter3";

import type LayoutManager from "../LayoutManager";

export type LayoutManagerContext = {
  busyCount: number;
  emitter: EventEmitter;
};

/**
 * Wraps an async LayoutManager method to emit busy events before and after it runs so the UI can
 * show that the operation is in progress.
 */
export function emitBusyStatus<Args extends unknown[], Ret>(
  method: (this: LayoutManager, ...args: Args) => Promise<Ret>,
): (this: LayoutManager, ...args: Args) => Promise<Ret> {
  return async function (this: LayoutManager, ...args: Args) {
    const ctx = this as unknown as LayoutManagerContext;
    try {
      ctx.busyCount++;
      ctx.emitter.emit("busychange");
      return await method.apply(this, args);
    } finally {
      ctx.busyCount--;
      ctx.emitter.emit("busychange");
    }
  };
}
