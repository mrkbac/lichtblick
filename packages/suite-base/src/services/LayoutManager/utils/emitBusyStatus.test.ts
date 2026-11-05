// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import EventEmitter from "eventemitter3";

import type LayoutManager from "../LayoutManager";
import { emitBusyStatus, LayoutManagerContext } from "./emitBusyStatus";

describe("emitBusyStatus", () => {
  describe("when executing a wrapped method", () => {
    let mockContext: LayoutManagerContext;
    let wrappedMethod: () => Promise<string>;
    let busyChangeEvents: number[];

    beforeEach(() => {
      // Given
      mockContext = {
        busyCount: 0,
        emitter: new EventEmitter(),
      };

      busyChangeEvents = [];
      mockContext.emitter.on("busychange", () => {
        busyChangeEvents.push(mockContext.busyCount);
      });

      const originalMethod = async function (this: typeof mockContext) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "success";
      };

      wrappedMethod = emitBusyStatus(
        originalMethod as unknown as (this: LayoutManager) => Promise<string>,
      ).bind(mockContext as unknown as LayoutManager);
    });

    it("should increment busy count before execution and decrement after completion", async () => {
      // Given
      expect(mockContext.busyCount).toBe(0);

      // When
      const resultPromise = wrappedMethod();

      // Then - busy count should be incremented immediately
      expect(mockContext.busyCount).toBe(1);

      const result = await resultPromise;

      // Then - operation should complete successfully and busy count should be reset
      expect(result).toBe("success");
      expect(mockContext.busyCount).toBe(0);
    });

    it("should emit busychange events when operation starts and completes", async () => {
      // When
      await wrappedMethod();

      // Then
      expect(busyChangeEvents).toEqual([1, 0]);
    });
  });
});
