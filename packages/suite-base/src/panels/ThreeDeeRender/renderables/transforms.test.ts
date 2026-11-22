// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { explainMissingTransform, missingTransformMessage } from "./transforms";
import { Transform, TransformTree } from "../transforms";

const tf = Transform.Identity();

function tree(): TransformTree {
  const result = new TransformTree();
  result.addTransform("base", "map", 0n, tf);
  result.addTransform("lidar", "base", 10n, tf);
  result.addTransform("camera", "rig", 0n, tf);
  return result;
}

describe("missingTransformMessage", () => {
  it("names a frame no transform mentions", () => {
    expect(missingTransformMessage(tree(), "map", "map", "gps", 20n, 20n)).toBe(
      "Missing transform from frame <gps> to frame <map>: no transform mentions frame <gps>",
    );
  });

  it("names the roots of frames in separate trees", () => {
    expect(missingTransformMessage(tree(), "base", "map", "camera", 20n, 20n)).toBe(
      "Missing transform from frame <camera> to frame <base>: <camera> and <map> are in separate trees (roots <rig> and <map>) that no transform connects",
    );
  });

  it("names the link with no sample near the message time", () => {
    // The lookup only clamps to a sample within maxDelta of the message time
    const result = new TransformTree();
    result.addTransform("base", "map", 0n, tf);
    result.addTransform("lidar", "base", 1_000n, tf);
    expect(explainMissingTransform(result, "map", "map", "lidar", 2_000n, 0n, 100n)).toBe(
      "no transform from <lidar> to <base> near the message time",
    );
  });

  it("checks the fixed-to-render leg at the playback time", () => {
    const result = new TransformTree();
    result.addTransform("odom", "map", 1_000n, tf);
    result.addTransform("base", "odom", 0n, tf);
    expect(explainMissingTransform(result, "map", "odom", "base", 0n, 0n, 100n)).toBe(
      "no transform from <odom> to <map> near the playback time",
    );
    expect(
      explainMissingTransform(result, "map", "odom", "base", 1_000n, 0n, 100n),
    ).toBeUndefined();
  });

  it("adds no reason when the lookup's own rules find every link", () => {
    expect(missingTransformMessage(tree(), "map", "map", "lidar", 20n, 5n)).toBe(
      "Missing transform from frame <lidar> to frame <map>",
    );
  });
});
