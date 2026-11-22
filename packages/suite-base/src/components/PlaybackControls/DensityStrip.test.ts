// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RecordingFileInfo } from "@lichtblick/suite-base/players/types";
import { DENSITY_BUCKETS } from "@lichtblick/suite-base/util/timelineDensity";

import { combineDensity, densityOf, densityPaths, isGap } from "./DensityStrip";

function file(start: number, end: number, bytes: number[]): RecordingFileInfo {
  const messageBytes = new Float32Array(DENSITY_BUCKETS);
  const per = DENSITY_BUCKETS / bytes.length;
  bytes.forEach((value, i) => messageBytes.fill(value / per, i * per, (i + 1) * per));
  return {
    library: "test",
    channels: [],
    schemaCount: 0,
    compression: [],
    attachments: [],
    start: { sec: start, nsec: 0 },
    end: { sec: end, nsec: 0 },
    messageBytes,
  };
}

describe("DensityStrip", () => {
  it("places each file in the shared range and marks slices far below the median as gaps", () => {
    // Given two files with nothing in [2, 4), the second with a pause ([5, 6) has 1% of the bytes)
    const files = [file(0, 2, [100, 100]), file(4, 8, [100, 1, 100, 100])];

    // When combined over [0, 8]
    const density = densityOf(combineDensity(files, { sec: 0, nsec: 0 }, { sec: 8, nsec: 0 })!);

    // Then both are gaps and the rest is not
    const at = (sec: number) => Math.floor((sec / 8) * DENSITY_BUCKETS);
    expect([1, 3, 4.5, 5.5, 7].map((sec) => isGap(density, at(sec)))).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(densityPaths(density).gaps).toBe(
      `M${at(2)} 0H${at(4)}V1H${at(2)}zM${at(5)} 0H${at(6)}V1H${at(5)}z`,
    );
  });

  it("shows nothing for a zero-duration recording", () => {
    const at = { sec: 1, nsec: 0 };
    expect(combineDensity([file(1, 1, [1])], at, at)).toBe(undefined);
  });

  it("shows nothing without file indexes", () => {
    const { messageBytes: _messageBytes, ...withoutIndex } = file(0, 1, [1]);
    expect(combineDensity([withoutIndex], { sec: 0, nsec: 0 }, { sec: 1, nsec: 0 })).toBe(
      undefined,
    );
  });
});
