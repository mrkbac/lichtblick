// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as Comlink from "@foxglove/comlink";

import { WorkerIterableSourceWorker } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSourceWorker";
import { BasicBuilder } from "@lichtblick/test-builders";

import { RosDb3IterableSource } from "./RosDb3IterableSource";
import { initialize } from "./RosDb3IterableSourceWorker.worker";

vi.mock("@foxglove/comlink", () => ({
  expose: vi.fn((val) => val),
  proxy: vi.fn((val) => val),
  transferHandlers: {
    set: vi.fn(),
  },
}));

vi.mock("./RosDb3IterableSource");
vi.mock("@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSourceWorker");

describe("initialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with multiple files", () => {
    const filename1 = `${BasicBuilder.string()}.bag`;
    const filename2 = `${BasicBuilder.string()}.bag`;
    const files = [new File(["data"], filename1), new File(["data"], filename2)];

    const result = initialize({ files });

    expect(RosDb3IterableSource).toHaveBeenCalledWith(files);
    expect(WorkerIterableSourceWorker).toHaveBeenCalled();
    expect(Comlink.proxy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(WorkerIterableSourceWorker);
  });

  it("should initialize with a single file", () => {
    const filename = `${BasicBuilder.string()}.bag`;
    const file = new File(["data"], filename);

    const result = initialize({ file });

    expect(RosDb3IterableSource).toHaveBeenCalledWith([file]);
    expect(WorkerIterableSourceWorker).toHaveBeenCalled();
    expect(Comlink.proxy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(WorkerIterableSourceWorker);
  });

  it("should throw with initialized with a url", () => {
    const url = `http://${BasicBuilder.string()}.com/${BasicBuilder.string()}.bag`;

    expect(() => {
      initialize({ url });
    }).toThrow("files required");
  });
});
