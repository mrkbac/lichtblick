/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

import { calculateOptimalWindowMs, subtractMilliseconds, timeToSec } from "./timeWindowHelpers";

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

  describe("timeToSec", () => {
    it("converts Time to seconds", () => {
      const time: Time = { sec: 10, nsec: 500_000_000 };
      const result = timeToSec(time);

      expect(result).toBe(10.5);
    });

    it("handles zero time", () => {
      const time: Time = { sec: 0, nsec: 0 };
      const result = timeToSec(time);

      expect(result).toBe(0);
    });

    it("handles time with only nanoseconds", () => {
      const time: Time = { sec: 0, nsec: 250_000_000 };
      const result = timeToSec(time);

      expect(result).toBe(0.25);
    });
  });

  describe("calculateOptimalWindowMs", () => {
    it("calculates window for dense topic (100 msg/s)", () => {
      const firstMessageTime: Time = { sec: 0, nsec: 0 };
      const lastMessageTime: Time = { sec: 10, nsec: 0 }; // 10 seconds
      const numMessages = 1000; // 100 msg/s

      const windowMs = calculateOptimalWindowMs({
        numMessages,
        firstMessageTime,
        lastMessageTime,
        targetMessagesInWindow: 10,
      });

      // Expecting ~100ms window (10 messages at 100 msg/s)
      expect(windowMs).toBe(100);
    });

    it("calculates window for sparse topic (1 msg/s)", () => {
      const firstMessageTime: Time = { sec: 0, nsec: 0 };
      const lastMessageTime: Time = { sec: 100, nsec: 0 }; // 100 seconds
      const numMessages = 100; // 1 msg/s

      const windowMs = calculateOptimalWindowMs({
        numMessages,
        firstMessageTime,
        lastMessageTime,
        targetMessagesInWindow: 10,
      });

      // Expecting ~10,000ms window (10 messages at 1 msg/s)
      expect(windowMs).toBe(10000);
    });

    it("clamps minimum to 100ms", () => {
      const firstMessageTime: Time = { sec: 0, nsec: 0 };
      const lastMessageTime: Time = { sec: 1, nsec: 0 };
      const numMessages = 10000; // Very dense topic

      const windowMs = calculateOptimalWindowMs({
        numMessages,
        firstMessageTime,
        lastMessageTime,
        targetMessagesInWindow: 10,
      });

      expect(windowMs).toBe(100); // Clamped to minimum
    });

    it("clamps maximum to 30000ms", () => {
      const firstMessageTime: Time = { sec: 0, nsec: 0 };
      const lastMessageTime: Time = { sec: 1000, nsec: 0 };
      const numMessages = 10; // Very sparse topic

      const windowMs = calculateOptimalWindowMs({
        numMessages,
        firstMessageTime,
        lastMessageTime,
        targetMessagesInWindow: 10,
      });

      expect(windowMs).toBe(30000); // Clamped to maximum
    });

    it("returns default 500ms for zero duration", () => {
      const time: Time = { sec: 10, nsec: 0 };
      const windowMs = calculateOptimalWindowMs({
        numMessages: 100,
        firstMessageTime: time,
        lastMessageTime: time, // Same time
        targetMessagesInWindow: 10,
      });

      expect(windowMs).toBe(500);
    });

    it("returns default 500ms for zero messages", () => {
      const firstMessageTime: Time = { sec: 0, nsec: 0 };
      const lastMessageTime: Time = { sec: 10, nsec: 0 };

      const windowMs = calculateOptimalWindowMs({
        numMessages: 0,
        firstMessageTime,
        lastMessageTime,
        targetMessagesInWindow: 10,
      });

      expect(windowMs).toBe(500);
    });
  });
});
