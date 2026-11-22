/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import { DataSourceFactoryInitializeArgs } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { WorkerSerializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource";
import { expandVideoSeekBackfill } from "@lichtblick/suite-base/players/IterablePlayer/videoSeekBackfill";

import RemoteDataSourceFactory from "./RemoteDataSourceFactory";

vi.mock("@lichtblick/suite-base/players/IterablePlayer", () => ({
  IterablePlayer: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource", () => ({
  WorkerSerializedIterableSource: vi.fn(),
}));

function setupArgs(params?: Record<string, string | undefined>): DataSourceFactoryInitializeArgs {
  const mockArgs: DataSourceFactoryInitializeArgs = {
    params,
  };
  return mockArgs;
}

describe("checkExtensionMatch", () => {
  let factory: RemoteDataSourceFactory;

  beforeEach(() => {
    factory = new RemoteDataSourceFactory();
  });

  it("should return the extension if the comparing extension is undefined", async () => {
    const result = (factory as any).checkExtensionMatch(".mcap");

    expect(result).toBe(".mcap");
  });

  it("should return the extension when the comparator and comparing extensions are equal", async () => {
    const result = (factory as any).checkExtensionMatch(".mcap", ".mcap");

    expect(result).toBe(".mcap");
  });

  it("should throw an error if the comparator and comparing extensions are different", async () => {
    expect(() => (factory as any).checkExtensionMatch(".mcap", ".bag")).toThrow(
      "All sources need to be from the same type",
    );
  });
});

describe("RemoteDataSourceFactory", () => {
  let factory: RemoteDataSourceFactory;

  const mockSource = { mock: "workerSource" };
  (WorkerSerializedIterableSource as Mock).mockImplementation(function () {
    return mockSource;
  });

  const mockPlayer = { mock: "playerInstance" };
  (IterablePlayer as Mock).mockImplementation(function () {
    return mockPlayer;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new RemoteDataSourceFactory();
  });
  it("should initialize and return a player with a single remote .mcap file", async () => {
    const mockArgs = setupArgs({
      url: "https://example.com/test.mcap",
    });

    const result = await factory.initialize(mockArgs);

    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
      initWorker: expect.any(Function),
      initArgs: { url: "https://example.com/test.mcap" },
    });

    expect(IterablePlayer).toHaveBeenCalledWith({
      source: mockSource,
      name: "https://example.com/test.mcap",
      urlParams: { urls: ["https://example.com/test.mcap"] },
      sourceId: "remote-file",
      readAheadDuration: { sec: 10, nsec: 0 },
      expandBackfill: expandVideoSeekBackfill,
    });

    expect(result).toBe(mockPlayer);
  });

  it("should initialize and return a player with a single remote .bag file", async () => {
    const mockArgs = setupArgs({
      url: "https://example.com/test.bag",
    });

    const result = await factory.initialize(mockArgs);

    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
      initWorker: expect.any(Function),
      initArgs: { url: "https://example.com/test.bag" },
    });

    expect(IterablePlayer).toHaveBeenCalledWith({
      source: mockSource,
      name: "https://example.com/test.bag",
      urlParams: { urls: ["https://example.com/test.bag"] },
      sourceId: "remote-file",
      readAheadDuration: { sec: 10, nsec: 0 },
      expandBackfill: expandVideoSeekBackfill,
    });

    expect(result).toBe(mockPlayer);
  });

  it("should initialize and return a player with multiple files", async () => {
    const mockArgs = setupArgs({
      url: "https://example.com/test1.mcap,https://example.com/test2.mcap",
    });

    const result = await factory.initialize(mockArgs);

    expect(IterablePlayer).toHaveBeenCalledWith({
      source: mockSource,
      name: mockArgs.params?.url,
      urlParams: { urls: ["https://example.com/test1.mcap", "https://example.com/test2.mcap"] },
      sourceId: "remote-file",
      readAheadDuration: { sec: 10, nsec: 0 },
      expandBackfill: expandVideoSeekBackfill,
    });

    expect(result).toBe(mockPlayer);
  });

  it("should pass configured hydration overrides into multi-url initArgs", async () => {
    factory = new RemoteDataSourceFactory({
      maxHydratedSources: 4,
      maxHydratedBytes: 5678,
      initConcurrency: 3,
    });
    const mockArgs = setupArgs({
      url: "https://example.com/test1.mcap,https://example.com/test2.mcap",
    });

    await factory.initialize(mockArgs);

    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
      initWorker: expect.any(Function),
      initArgs: {
        urls: ["https://example.com/test1.mcap", "https://example.com/test2.mcap"],
        maxHydratedSources: 4,
        maxHydratedBytes: 5678,
        initConcurrency: 3,
      },
    });
  });

  it("should send cookies and keep the flag in the URL when ds.includeCredentials=true", async () => {
    const mockArgs = setupArgs({
      url: "https://example.com/test1.mcap,https://example.com/test2.mcap",
      includeCredentials: "true",
    });

    await factory.initialize(mockArgs);

    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
      initWorker: expect.any(Function),
      initArgs: {
        urls: ["https://example.com/test1.mcap", "https://example.com/test2.mcap"],
        credentials: "include",
      },
    });
    expect(IterablePlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        urlParams: {
          urls: ["https://example.com/test1.mcap", "https://example.com/test2.mcap"],
          includeCredentials: "true",
        },
      }),
    );
  });

  it("should title the player with ds.name and keep it in the URL", async () => {
    await factory.initialize(
      setupArgs({ url: "https://example.com/test.mcap", name: "Sample drive" }),
    );

    expect(IterablePlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sample drive",
        urlParams: { urls: ["https://example.com/test.mcap"], name: "Sample drive" },
      }),
    );
  });

  it("should not send cookies unless ds.includeCredentials is exactly true", async () => {
    await factory.initialize(
      setupArgs({ url: "https://example.com/test.bag", includeCredentials: "1" }),
    );

    const [{ initArgs }] = (WorkerSerializedIterableSource as Mock).mock.calls[0]!;
    expect(initArgs.credentials).toBeUndefined();
  });

  it("should return undefined if args.params.url is undefined", async () => {
    const mockArgs = setupArgs();

    const result = await factory.initialize(mockArgs);

    expect(result).toBeUndefined();
  });

  it("should throw an error if the multiple sources don't have the same file extension", async () => {
    const mockArgs = setupArgs({
      url: "https://example.com/test.mcap,https://example.com/test.bag",
    });

    await expect(factory.initialize(mockArgs)).rejects.toThrow(
      "All sources need to be from the same type",
    );
  });

  it.each([".db3", ".ulg", ".csv"])(
    "should explain that %s files can't be opened from a URL",
    async (ext) => {
      const mockArgs = setupArgs({ url: `https://example.com/test${ext}` });

      await expect(factory.initialize(mockArgs)).rejects.toThrow(
        `${ext} files can't be opened from a URL yet`,
      );
    },
  );
});
