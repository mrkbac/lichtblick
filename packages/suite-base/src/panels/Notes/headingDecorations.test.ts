// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { headingDecorations } from "./headingDecorations";

describe("headingDecorations", () => {
  it("sizes all six heading levels without hiding their source", () => {
    const text = "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six";
    const decorations = headingDecorations(text, 20);
    expect(decorations.map(({ options }) => options.fontSize)).toEqual([
      "40px",
      "32px",
      "27px",
      "23px",
      "20px",
      "20px",
    ]);
    expect(decorations[0]?.range).toEqual({
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 1,
      endColumn: 6,
    });
  });

  it("ignores escaped hashes, code, invalid headings and fenced code", () => {
    expect(
      headingDecorations(
        "\\# escaped\n#hashtag\n####### seven\n    # code\n```md\n# code\n````\n~~~\n## code\n~~~\n  ## real",
        10,
      ),
    ).toMatchObject([{ range: { startLineNumber: 11 }, options: { fontSize: "16px" } }]);
  });

  it("keeps shorter fences inside the code block", () => {
    expect(headingDecorations("````\n```\n# code\n````\n# real", 12)).toHaveLength(1);
  });

  it("supports CRLF and empty headings", () => {
    expect(headingDecorations("#\r\ntext", 16)).toMatchObject([
      { range: { startLineNumber: 1, endColumn: 2 }, options: { fontSize: "32px" } },
    ]);
  });
});
