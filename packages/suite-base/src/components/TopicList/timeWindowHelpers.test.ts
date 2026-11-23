/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

import { subtractMilliseconds } from "./timeWindowHelpers";
import { initialWindowMs } from "./topicNavigationReads";

describe("timeWindowHelpers", () => {
  describe("subtractMilliseconds", () => {
    it("subtracts milliseconds without underflow", () => {
      const time: Time = { sec: 10, nsec: 500_000_000 };
      const result = subtractMilliseconds(time, 100);

      expect(result).toEqual({ sec: 10, nsec: 400_000_000 });
    });

    it("handles nanosecond underflow", () => {
      const time: Time = { sec: 10, nsec: 50_000_000 };
      const result = subtractMilliseconds(time, 100);

      // 50ms - 100ms = -50ms, which should wrap to previous second
      expect(result).toEqual({ sec: 9, nsec: 950_000_000 });
    });

    it("handles large millisecond subtraction", () => {
      const time: Time = { sec: 100, nsec: 0 };
      const result = subtractMilliseconds(time, 5000); // 5 seconds

      expect(result).toEqual({ sec: 95, nsec: 0 });
    });

    it("subtracts very large windows in constant time", () => {
      expect(subtractMilliseconds({ sec: 10, nsec: 0 }, 1e15)).toEqual({ sec: 10 - 1e12, nsec: 0 });
    });
  });

  describe("initialWindowMs", () => {
    it("spans about two messages at the topic's rate, clamped to 100 ms to 30 s", () => {
      const zero: Time = { sec: 0, nsec: 0 };
      expect(initialWindowMs(100, zero, { sec: 100, nsec: 0 })).toBe(2000);
      expect(initialWindowMs(10_000, zero, { sec: 1, nsec: 0 })).toBe(100);
      expect(initialWindowMs(10, zero, { sec: 1000, nsec: 0 })).toBe(30_000);
    });

    it("falls back to 500 ms without a rate", () => {
      const time: Time = { sec: 10, nsec: 0 };
      expect(initialWindowMs(100, time, time)).toBe(500);
      expect(initialWindowMs(0, { sec: 0, nsec: 0 }, time)).toBe(500);
      expect(initialWindowMs(undefined, undefined, time)).toBe(500);
    });
  });
});
