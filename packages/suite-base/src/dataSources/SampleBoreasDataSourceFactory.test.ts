// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import SampleBoreasDataSourceFactory from "@lichtblick/suite-base/dataSources/SampleBoreasDataSourceFactory";
import {
  SAMPLE_BOREAS_DATA_SOURCE_DISPLAY_NAME,
  SAMPLE_BOREAS_DATA_SOURCE_ICON_NAME,
  SAMPLE_BOREAS_DATA_SOURCE_ID,
  SAMPLE_BOREAS_DATA_SOURCE_NAME,
  SAMPLE_BOREAS_DATA_SOURCE_READ_AHEAD_DURATION,
  SAMPLE_BOREAS_DATA_SOURCE_TYPE,
  SAMPLE_BOREAS_DATA_SOURCE_URL,
} from "@lichtblick/suite-base/dataSources/constants";
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
      name: SAMPLE_BOREAS_DATA_SOURCE_NAME,
      urlParams: {},
      sourceId: SAMPLE_BOREAS_DATA_SOURCE_ID,
      readAheadDuration: SAMPLE_BOREAS_DATA_SOURCE_READ_AHEAD_DURATION,
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
          url: SAMPLE_BOREAS_DATA_SOURCE_URL,
        },
      }),
    );
  });

  it("should have correct factory properties", async () => {
    //Given / When / Then
    expect(factory.id).toBe(SAMPLE_BOREAS_DATA_SOURCE_ID);
    expect(factory.type).toBe(SAMPLE_BOREAS_DATA_SOURCE_TYPE);
    expect(factory.displayName).toBe(SAMPLE_BOREAS_DATA_SOURCE_DISPLAY_NAME);
    expect(factory.iconName).toBe(SAMPLE_BOREAS_DATA_SOURCE_ICON_NAME);
    expect(factory.hidden).toBe(true);
    expect(factory.legacyIds).toEqual(["sample-nuscenes"]);
    expect(factory.sampleLayout).toBeDefined();
  });
});
