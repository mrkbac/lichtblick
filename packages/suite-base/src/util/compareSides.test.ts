// SPDX-License-Identifier: MPL-2.0

import type { IDataSourceFactory } from "@lichtblick/suite-base/context/PlayerSelectionContext";

import {
  compareNamesOf,
  draftFromFiles,
  draftToCompare,
  encodeCompareNames,
  joinUrls,
  mergeArgs,
  recordingExtension,
  recordingName,
} from "./compareSides";

// Node's File has no webkitRelativePath
const file = (name: string) =>
  Object.defineProperty(new File([], name), "webkitRelativePath", { value: "" });

describe("compare drafts", () => {
  const base = file("base.mcap");
  const a = file("a.mcap");
  const b = file("b.mcap");
  const c = file("c.mcap");

  it("adds shared files to every side and names sides after their first file", () => {
    const draft = {
      shared: [base],
      sides: [
        { name: "", files: [a] },
        { name: "Tuned", files: [b] },
        { name: "", files: [] },
        { name: "", files: [c] },
      ],
    };
    expect(draftToCompare(draft)).toEqual({
      files: [base, a, base, b, base, c],
      compare: ["a.mcap", "a.mcap", "Tuned", "Tuned", "c.mcap", "c.mcap"],
    });
  });

  it("round-trips through the side names", () => {
    const draft = {
      shared: [base],
      sides: [
        { name: "", files: [a] },
        { name: "B", files: [b, c] },
      ],
    };
    const { files, compare } = draftToCompare(draft);
    expect(draftFromFiles(files, compare)).toEqual(draft);
  });

  it("doesn't share a file that a side only repeats", () => {
    const draft = draftFromFiles([base, a, base, base], ["x", "x", "y", "y"]);
    expect(draft.shared).toEqual([]);
    expect(draft.sides).toHaveLength(2);
  });

  it("doesn't share a file that is a whole side", () => {
    const draft = draftFromFiles([base, base, a], ["x", "y", "y"]);
    expect(draft.shared).toEqual([]);
    expect(draft.sides.map((side) => side.files)).toEqual([[base], [base, a]]);
  });

  it("makes each loose file a side when not compared yet", () => {
    expect(draftFromFiles([a, b]).sides).toEqual([
      { name: "", files: [a] },
      { name: "", files: [b] },
    ]);
  });

  it("mixes remote URLs into a side and names them after their file", () => {
    const url = "https://example.com/runs/drive%201.mcap?token=x";
    const draft = {
      shared: [],
      sides: [
        { name: "", files: [url] },
        { name: "", files: [a] },
      ],
    };
    const { files, compare } = draftToCompare(draft);
    expect(files).toEqual([url, a]);
    expect(compare).toEqual(["drive 1.mcap", "a.mcap"]);
    expect(draftFromFiles(files, compare)).toEqual(draft);
    expect(draftFromFiles([url, a])).toEqual(draft);
  });
});

describe("recording names", () => {
  it("reads the file name and extension of URLs and files", () => {
    expect(recordingName("https://example.com/a/b.mcap?x=1")).toBe("b.mcap");
    expect(recordingExtension("https://example.com/a/b.mcap?x=1")).toBe(".mcap");
    expect(recordingName(file("c.bag"))).toBe("c.bag");
    expect(recordingExtension(file("c.bag"))).toBe(".bag");
  });
});

describe("side names in params", () => {
  it("keeps commas and percent signs in compareNames", () => {
    const names = ["a.mcap", "B, tuned", "100% load"];
    const compareNames = encodeCompareNames(names);
    expect(compareNames).toBe("a.mcap,B%2C tuned,100%25 load");
    expect(compareNamesOf({ compareNames })).toEqual(names);
  });

  it("reads older plain compare lists as they are, keeping labels like %41 apart from A", () => {
    expect(compareNamesOf({ compare: "A,%41" })).toEqual(["A", "%41"]);
    expect(compareNamesOf({ compare: "true" })).toBeUndefined();
    expect(compareNamesOf({})).toBeUndefined();
  });

  it("prefers compareNames over compare, whatever compare says", () => {
    expect(compareNamesOf({ compare: "true", compareNames: "A,B,C" })).toEqual(["A", "B", "C"]);
    expect(compareNamesOf({ compare: "X,Y", compareNames: "A,B,C" })).toEqual(["A", "B", "C"]);
  });
});

describe("recording names of URLs", () => {
  it("falls back to the raw file name when it has a literal %", () => {
    expect(recordingName("https://example.com/runs/100%.mcap")).toBe("100%.mcap");
  });
});

describe("mergeArgs", () => {
  const remote = { id: "remote", type: "connection" } as IDataSourceFactory;
  const local = { id: "mcap", type: "file" } as IDataSourceFactory;

  it("keeps the cookie setting of merged remote recordings, each URL once", () => {
    expect(
      mergeArgs(remote, ["https://e.com/a.mcap", "https://e.com/a.mcap"], { withCookies: true }),
    ).toEqual({
      type: "connection",
      params: { url: "https://e.com/a.mcap", includeCredentials: "true" },
    });
    expect(mergeArgs(remote, ["https://e.com/a.mcap"], { withCookies: false })).toEqual({
      type: "connection",
      params: { url: "https://e.com/a.mcap" },
    });
  });

  it("merges files (and URLs mixed in) as file args", () => {
    const f = file("a.mcap");
    expect(mergeArgs(local, [f, "https://e.com/b.mcap", f], { withCookies: false })).toEqual({
      type: "file",
      files: [f, "https://e.com/b.mcap"],
    });
  });
});

describe("joinUrls", () => {
  it("keeps a URL with a comma whole when the list is split on commas", () => {
    const joined = joinUrls(["https://e.com/run,1.mcap", "https://e.com/b.mcap"]);
    expect(joined.split(",")).toEqual(["https://e.com/run%2C1.mcap", "https://e.com/b.mcap"]);
    expect(recordingName(joined.split(",")[0]!)).toBe("run,1.mcap");
  });
});
