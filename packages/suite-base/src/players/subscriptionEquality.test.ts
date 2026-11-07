// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { sameTopicSelection, subscriptionCovers } from "./subscriptionEquality";

describe("sameTopicSelection", () => {
  it("ignores unset keys and the order of fields", () => {
    expect(
      sameTopicSelection(
        new Map([["a", { topic: "a", preloadType: "full", fields: ["x", "y"] }]]),
        new Map([
          [
            "a",
            { topic: "a", preloadType: "full", fields: ["y", "x"], samplingRequest: undefined },
          ],
        ]),
      ),
    ).toBe(true);
  });

  it("sees different topics or fields", () => {
    const a = new Map([["a", { topic: "a", fields: ["x"] }]]);
    expect(sameTopicSelection(a, new Map([["a", { topic: "a", fields: ["y"] }]]))).toBe(false);
    expect(sameTopicSelection(a, new Map([["b", { topic: "b", fields: ["x"] }]]))).toBe(false);
    expect(sameTopicSelection(a, new Map())).toBe(false);
  });
});

describe("subscriptionCovers", () => {
  it("lets whole messages, or more fields, serve a subscription", () => {
    expect(subscriptionCovers({ topic: "a" }, { topic: "a", fields: ["x"] })).toBe(true);
    expect(
      subscriptionCovers({ topic: "a", fields: ["x", "y"] }, { topic: "a", fields: ["y"] }),
    ).toBe(true);
  });

  it("reloads when fewer fields were loaded than are needed", () => {
    expect(subscriptionCovers({ topic: "a", fields: ["x"] }, { topic: "a" })).toBe(false);
    expect(subscriptionCovers({ topic: "a", fields: ["x"] }, { topic: "a", fields: ["y"] })).toBe(
      false,
    );
    expect(subscriptionCovers(undefined, { topic: "a" })).toBe(false);
  });
});
