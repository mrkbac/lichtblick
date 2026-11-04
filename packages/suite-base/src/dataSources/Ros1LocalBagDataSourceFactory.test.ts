// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DataSourceFactoryInitializeArgs } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { WorkerSerializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource";
import { BasicBuilder } from "@lichtblick/test-builders";

import Ros1LocalBagDataSourceFactory from "./Ros1LocalBagDataSourceFactory";

vi.mock("@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource");
vi.mock("@lichtblick/suite-base/players/IterablePlayer");

describe("Ros1LocalBagDataSourceFactory", () => {
  let factory: Ros1LocalBagDataSourceFactory;

  beforeEach(() => {
    factory = new Ros1LocalBagDataSourceFactory();
  });

  it("should have correct metadata", () => {
    expect(factory.id).toBe("ros1-local-bagfile");
    expect(factory.type).toBe("file");
    expect(factory.displayName).toBe("ROS 1 Bag");
    expect(factory.iconName).toBe("OpenFile");
    expect(factory.supportedFileTypes).toEqual([".bag"]);
  });

  it("should return undefined if no files are provided", () => {
    const result = factory.initialize({
      files: [],
    });

    expect(result).toBeUndefined();
  });

  it("should return undefined if no file is provided", () => {
    const result = factory.initialize({
      file: undefined,
    });

    expect(result).toBeUndefined();
  });

  it("should return undefined if undefined file is provided", () => {
    const result = factory.initialize({
      files: [undefined as unknown as File],
    });

    expect(result).toBeUndefined();
  });

  it.each([
    {
      file: new File([BasicBuilder.string()], `${BasicBuilder.string()}.bag`),
    },
    {
      files: [new File([BasicBuilder.string()], `${BasicBuilder.string()}.bag`)],
    },
  ])("should return an IterablePlayer", (args: DataSourceFactoryInitializeArgs) => {
    const expectedInitArgs = {
      ...(args.file ? { file: args.file } : undefined),
      ...(args.files ? { file: args.files[0] } : undefined),
    };

    const player = factory.initialize(args);

    expect(player).toBeInstanceOf(IterablePlayer);
    expect(WorkerSerializedIterableSource).toHaveBeenCalledWith({
      initWorker: expect.any(Function),
      initArgs: expectedInitArgs,
    });
    expect(IterablePlayer).toHaveBeenCalledWith({
      source: expect.any(WorkerSerializedIterableSource),
      name: expectedInitArgs.file?.name,
      sourceId: expect.any(String),
      readAheadDuration: { sec: 120, nsec: 0 },
    });
  });
});
