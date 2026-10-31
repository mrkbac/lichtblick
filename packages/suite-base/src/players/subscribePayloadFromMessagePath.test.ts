// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { subscribePayloadFromMessagePath } from "@lichtblick/suite-base/players/subscribePayloadFromMessagePath";

describe("subscribePayloadFromMessagePath", () => {
  it("handles whole topic paths", () => {
    const result = subscribePayloadFromMessagePath("topic", "partial");
    expect(result).toEqual({ topic: "topic", preloadType: "partial" });
  });

  it("handles specific field paths", () => {
    const result = subscribePayloadFromMessagePath("topic.field");
    expect(result).toEqual({ topic: "topic", fields: ["field"], preloadType: "partial" });
  });

  it("handles nested field paths", () => {
    const result = subscribePayloadFromMessagePath("topic.field.subfield");
    expect(result).toEqual({ topic: "topic", fields: ["field"], preloadType: "partial" });
  });

  it("subscribes to the whole message when a modifier precedes the first field", () => {
    expect(subscribePayloadFromMessagePath("topic.@quat.w")).toEqual({
      topic: "topic",
      preloadType: "partial",
    });
    expect(subscribePayloadFromMessagePath("topic.field.@product(a, b)")).toEqual({
      topic: "topic",
      fields: ["field"],
      preloadType: "partial",
    });
  });

  it("handles complex paths", () => {
    const result = subscribePayloadFromMessagePath("topic{x==1}.field[:].subfield");
    expect(result).toEqual({ topic: "topic", fields: ["field"], preloadType: "partial" });
  });
});
