// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import SampleBoreasDataSourceFactory from "@lichtblick/suite-base/dataSources/SampleBoreasDataSourceFactory";
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { WorkerSerializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource";
import { expandVideoSeekBackfill } from "@lichtblick/suite-base/players/IterablePlayer/videoSeekBackfill";

vi.mock("@lichtblick/suite-base/players/IterablePlayer", () => ({
  IterablePlayer: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource", () => ({
  WorkerSerializedIterableSource: vi.fn(),
}));

describe("SampleBoreasDataSourceFactory", () => {
  let factory: SampleBoreasDataSourceFactory;

  beforeEach(() => {
    factory = new SampleBoreasDataSourceFactory();
    vi.clearAllMocks();
  });

  it("should create a IterablePlayer with the sample Boreas data source", async () => {
    // When
    const player = await factory.initialize();

    // Then
    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
      initWorker: expect.any(Function),
      initArgs: { url: expect.any(String) },
    });

    expect(IterablePlayer).toHaveBeenCalledWith({
      source: expect.any(Object),
      name: expect.stringContaining("Boreas dataset"),
      urlParams: {},
      sourceId: "sample-boreas",
      readAheadDuration: { sec: 10, nsec: 0 },
      expandBackfill: expandVideoSeekBackfill,
    });
    expect(player).toBeInstanceOf(IterablePlayer);
  });

  it("should use the correct sample Boreas data source URL", async () => {
    // When
    await factory.initialize();

    // Then
    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith(
      expect.objectContaining({
        initArgs: {
          url: expect.stringMatching(/boreas-showcase-v2\.mcap$/),
        },
      }),
    );
  });

  it("should have correct factory properties", async () => {
    //Given / When / Then
    expect(factory.id).toBe("sample-boreas");
    expect(factory.type).toBe("sample");
    expect(factory.displayName).toBe("Sample: Boreas");
    expect(factory.iconName).toBe("FileASPX");
    expect(factory.hidden).toBe(true);
    expect(factory.legacyIds).toEqual(["sample-nuscenes"]);
    expect(factory.sampleLayout).toBeDefined();
  });
});
