// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { samplesFromMessage } from "./transforms";

describe("samplesFromMessage", () => {
  const message = (rotation: Record<string, number>) => ({
    header: { stamp: { sec: 1, nsec: 0 }, frame_id: "world" },
    child_frame_id: "base",
    transform: { translation: { x: 0, y: 0, z: 0 }, rotation },
  });

  it("skips a transform whose rotation lacks a component", () => {
    expect(
      samplesFromMessage("geometry_msgs/TransformStamped", message({ x: 0, y: 0, z: 0 })),
    ).toEqual({ samples: [], malformed: true });
  });

  it("keeps a well-formed transform", () => {
    const { samples, malformed } = samplesFromMessage(
      "geometry_msgs/TransformStamped",
      message({ x: 0, y: 0, z: 0, w: 1 }),
    );
    expect(malformed).toBe(false);
    expect(samples).toHaveLength(1);
  });
});
