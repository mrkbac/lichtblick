// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { draftFromFiles, draftToCompare } from "./compareSides";

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
});
