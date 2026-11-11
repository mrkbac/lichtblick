// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import * as Comlink from "@foxglove/comlink";

import { WorkerIterableSourceWorker } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSourceWorker";
import { MultiIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/shared/MultiIterableSource";
import { BasicBuilder } from "@lichtblick/test-builders";

import { McapIterableSource } from "./McapIterableSource";
import { initialize } from "./McapIterableSourceWorker.worker";

vi.mock("@foxglove/comlink", () => ({
  expose: vi.fn((val) => val),
  proxy: vi.fn((val) => val),
  transferHandlers: {
    set: vi.fn(),
  },
}));

vi.mock("./McapIterableSource");
vi.mock("@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSourceWorker");
vi.mock("@lichtblick/suite-base/players/IterablePlayer/shared/MultiIterableSource");

describe("initialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with a single file", () => {
    const filename = `${BasicBuilder.string()}.mcap`;
    const file = new File(["data"], filename);

    const result = initialize({ file });

    expect(McapIterableSource).toHaveBeenCalledWith({ type: "file", file });
    expect(WorkerIterableSourceWorker).toHaveBeenCalled();
    expect(Comlink.proxy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(WorkerIterableSourceWorker);
  });

  it("should initialize with multiple files", () => {
    const filename1 = `${BasicBuilder.string()}.mcap`;
    const filename2 = `${BasicBuilder.string()}.mcap`;
    const files = [new File(["data"], filename1), new File(["data"], filename2)];

    const result = initialize({ files });

    expect(MultiIterableSource).toHaveBeenCalledWith({ type: "files", files }, McapIterableSource);
    expect(WorkerIterableSourceWorker).toHaveBeenCalled();
    expect(Comlink.proxy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(WorkerIterableSourceWorker);
  });

  it("should pass hydration overrides through for multiple files", () => {
    const filename1 = `${BasicBuilder.string()}.mcap`;
    const filename2 = `${BasicBuilder.string()}.mcap`;
    const files = [new File(["data"], filename1), new File(["data"], filename2)];

    const result = initialize({
      files,
      maxHydratedSources: 3,
      maxHydratedBytes: 1234,
      initConcurrency: 2,
    });

    expect(MultiIterableSource).toHaveBeenCalledWith(
      {
        type: "files",
        files,
        maxHydratedSources: 3,
        maxHydratedBytes: 1234,
        initConcurrency: 2,
      },
      McapIterableSource,
    );
    expect(WorkerIterableSourceWorker).toHaveBeenCalled();
    expect(Comlink.proxy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(WorkerIterableSourceWorker);
  });

  it("should initialize with a single URL", () => {
    const url = `http://${BasicBuilder.string()}.com/${BasicBuilder.string()}.mcap`;

    const result = initialize({ url });

    expect(McapIterableSource).toHaveBeenCalledWith({ type: "url", url });
    expect(WorkerIterableSourceWorker).toHaveBeenCalled();
    expect(Comlink.proxy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(WorkerIterableSourceWorker);
  });

  it("should initialize with multiple URLs", () => {
    const urls = [
      `http://${BasicBuilder.string()}.com/${BasicBuilder.string()}.mcap`,
      `http://${BasicBuilder.string()}.com/${BasicBuilder.string()}.mcap`,
    ];

    const result = initialize({ urls });

    expect(MultiIterableSource).toHaveBeenCalledWith({ type: "urls", urls }, McapIterableSource);
    expect(WorkerIterableSourceWorker).toHaveBeenCalled();
    expect(Comlink.proxy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(WorkerIterableSourceWorker);
  });

  it("should pass hydration overrides through for multiple URLs", () => {
    const urls = [
      `http://${BasicBuilder.string()}.com/${BasicBuilder.string()}.mcap`,
      `http://${BasicBuilder.string()}.com/${BasicBuilder.string()}.mcap`,
    ];

    const result = initialize({
      urls,
      maxHydratedSources: 4,
      maxHydratedBytes: 5678,
      initConcurrency: 3,
    });

    expect(MultiIterableSource).toHaveBeenCalledWith(
      {
        type: "urls",
        urls,
        maxHydratedSources: 4,
        maxHydratedBytes: 5678,
        initConcurrency: 3,
      },
      McapIterableSource,
    );
    expect(WorkerIterableSourceWorker).toHaveBeenCalled();
    expect(Comlink.proxy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(WorkerIterableSourceWorker);
  });

  it("should throw an error if no valid input is provided", () => {
    expect(() => initialize({})).toThrow("file or url required");
  });
});
