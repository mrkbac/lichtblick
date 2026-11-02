// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "fake-indexeddb/auto";

import { FolderFile, indexFiles, listInputFiles } from "./indexFolder";
import { summarizeMcap } from "./summarizeMcap";

vi.mock("./summarizeMcap");
const summarize = vi.mocked(summarizeMcap);

// The cache is keyed by name, size and modification time, so every test uses its own mtime.
let mtime = 1;

function folderFile(path: string, delayMs = 0): FolderFile {
  const file = new File(["x"], path.split("/").pop()!, { lastModified: mtime });
  return {
    path,
    getFile: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return file;
    },
  };
}

describe("indexFiles", () => {
  beforeEach(() => {
    mtime++;
    summarize.mockReset();
    summarize.mockImplementation(async (file) => ({ messages: (file as File).name.length }));
  });

  it("returns results in input order when files finish out of order", async () => {
    const files = [
      folderFile("a/slow.mcap", 30),
      folderFile("b/x.mcap", 0),
      folderFile("c.mcap", 10),
    ];
    const reported: string[] = [];
    const results = await indexFiles(files, { onRecording: (r) => reported.push(r.id) });
    expect(results.map((r) => r.id)).toEqual(["a/slow.mcap", "b/x.mcap", "c.mcap"]);
    expect(reported).toEqual(["b/x.mcap", "c.mcap", "a/slow.mcap"]);
    expect(results[0]).toMatchObject({
      name: "slow.mcap",
      source: { type: "local-file", path: "a/slow.mcap" },
      size: 1,
      messages: 9,
    });
  });

  it("reuses cached summaries, also from another folder", async () => {
    await indexFiles([folderFile("run.mcap")]);
    const [moved] = await indexFiles([folderFile("day-one/run.mcap")]);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(moved).toMatchObject({ id: "day-one/run.mcap", messages: 8 });
  });

  it("re-reads cached errors only when asked to", async () => {
    summarize.mockRejectedValueOnce(new Error("bad file"));
    const [first] = await indexFiles([folderFile("bad.mcap")]);
    expect(first!.error).toBe("bad file");

    await indexFiles([folderFile("bad.mcap")]);
    expect(summarize).toHaveBeenCalledTimes(1);

    const [retried] = await indexFiles([folderFile("bad.mcap")], { retryErrors: true });
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(retried!.error).toBeUndefined();
  });

  it("stops reading files once cancelled", async () => {
    const files = Array.from({ length: 10 }, (_, i) => folderFile(`${i}.mcap`));
    let read = 0;
    await indexFiles(files, { isCancelled: () => read >= 4, onRecording: () => read++ });
    expect(summarize.mock.calls.length).toBeLessThan(10);
  });
});

describe("listInputFiles", () => {
  it("keeps MCAP files and strips the picked folder name", () => {
    const file = (path: string) => {
      const f = new File([""], path.split("/").pop()!);
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      return f;
    };
    const files = listInputFiles([
      file("root/a.mcap"),
      file("root/sub/B.MCAP"),
      file("root/notes.txt"),
    ]);
    expect(files.map((f) => f.path)).toEqual(["a.mcap", "sub/B.MCAP"]);
  });
});
