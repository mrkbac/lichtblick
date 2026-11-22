/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import { DataSourceFactoryInitializeArgs } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { sourceURLState } from "@lichtblick/suite-base/hooks/useStateToURLSynchronization";
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { WorkerSerializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource";
import { expandVideoSeekBackfill } from "@lichtblick/suite-base/players/IterablePlayer/videoSeekBackfill";
import { parseAppURLState } from "@lichtblick/suite-base/util/appURLState";
import { buildShareLink } from "@lichtblick/suite-base/util/shareLink";

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
    const mockArgs = { urls: ["https://example.com/test1.mcap", "https://example.com/test2.mcap"] };

    const result = await factory.initialize(mockArgs);

    expect(IterablePlayer).toHaveBeenCalledWith({
      source: mockSource,
      name: mockArgs.urls.join(),
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
    const mockArgs = { urls: ["https://example.com/test1.mcap", "https://example.com/test2.mcap"] };

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
    const mockArgs = {
      urls: ["https://example.com/test1.mcap", "https://example.com/test2.mcap"],
      params: { includeCredentials: "true" },
    };

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

  it("plays and rewrites the URL with compareNames when compare is also given", async () => {
    const urls = ["a", "b", "c"].map((name) => `https://example.com/${name}.mcap`);
    await factory.initialize({ urls, params: { compare: "true", compareNames: "A%2C1,B,C" } });

    const [{ initArgs }] = (WorkerSerializedIterableSource as Mock).mock.calls[0]!;
    expect(initArgs.compare).toEqual(["A,1", "B", "C"]);
    const [{ urlParams }] = (IterablePlayer as Mock).mock.calls[0]!;
    expect(urlParams).toEqual({ urls, compareNames: "A%2C1,B,C" });
  });

  it("reopens a comparison share link with exact URL strings and the offsets of its sides", async () => {
    const urls = [
      "https://example.com/map,1.mcap",
      "https://example.com/run.mcap?tag=a,https://example.com/photo",
      "https://example.com/other.mcap",
    ];
    const playerState = {
      sourceId: "remote-file",
      parameters: { urls, compareNames: "A,A,B" },
    };
    const time = { sec: 100, nsec: 0 };
    const sides = [
      { prefix: "/a", name: "A", start: time, end: time, sharedStart: time, offsetSec: -2 },
      { prefix: "/b", name: "B", start: time, end: time, sharedStart: time, offsetSec: 0.25 },
    ];
    const { link } = buildShareLink(
      "https://example.com/",
      sourceURLState(playerState, undefined, sides),
      undefined,
    );
    const reopened = parseAppURLState(new URL(link));
    const reset = sourceURLState(
      { ...playerState, parameters: { ...playerState.parameters, compareOffsets: "-2,0.25" } },
      undefined,
      sides.map((side) => ({ ...side, offsetSec: 0 })),
    );
    expect(reset.dsParams?.compareOffsets).toBeUndefined();
    await factory.initialize({ urls: reopened?.dsParamsArray?.urls, params: reopened?.dsParams });

    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
      initWorker: expect.any(Function),
      initArgs: { urls, compare: ["A", "A", "B"], compareOffsets: [-2, 0.25] },
    });
  });

  it("opens a single URL containing a comma followed by a scheme", async () => {
    const url = "https://example.com/run,1.mcap?tag=a,https://example.com/photo";
    await factory.initialize({ params: { url } });

    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
      initWorker: expect.any(Function),
      initArgs: { url },
    });
  });

  it.each(["-2", "1,Infinity", "1,", "3,1e100"])(
    "ignores invalid share offsets (%s)",
    async (value) => {
      const urls = ["https://example.com/a.mcap", "https://example.com/b.mcap"];
      await factory.initialize({ urls, params: { compare: "true", compareOffsets: value } });
      expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
        initWorker: expect.any(Function),
        initArgs: { urls, compare: ["a.mcap", "b.mcap"] },
      });
    },
  );

  it("should return undefined if args.params.url is undefined", async () => {
    const mockArgs = setupArgs();

    const result = await factory.initialize(mockArgs);

    expect(result).toBeUndefined();
  });

  it("should throw an error if the multiple sources don't have the same file extension", async () => {
    const mockArgs = { urls: ["https://example.com/test.mcap", "https://example.com/test.bag"] };

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
