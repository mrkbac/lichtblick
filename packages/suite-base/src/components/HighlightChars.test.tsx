/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";

import { fuzzyPositions, HighlightChars, substringPositions } from "./HighlightChars";

const highlighted = (container: HTMLElement) =>
  [...container.querySelectorAll("mark")].map((el) => el.textContent);

describe("HighlightChars", () => {
  it("wraps matched runs and renders markup in the text as text", () => {
    const str = "<b>Raw Messages</b>";
    const { container } = render(<HighlightChars str={str} indices={fuzzyPositions(str, "raw")} />);
    expect(container.textContent).toBe(str);
    expect(container.querySelector("b")).toBeNull();
    expect(highlighted(container)).toEqual(["Raw"]);
  });

  it("renders plain text without a match", () => {
    const { container } = render(
      <HighlightChars str="Plot" indices={fuzzyPositions("Plot", "zzz")} />,
    );
    expect(container.textContent).toBe("Plot");
    expect(highlighted(container)).toEqual([]);
  });

  it("applies the offset to indices", () => {
    const { container } = render(<HighlightChars str="bar" indices={new Set([3])} offset={3} />);
    expect(highlighted(container)).toEqual(["b"]);
  });

  it("highlights every substring occurrence case-insensitively", () => {
    const str = "abc ABC abc";
    const { container } = render(
      <HighlightChars str={str} indices={substringPositions(str, "abc")} />,
    );
    expect(highlighted(container)).toEqual(["abc", "ABC", "abc"]);
  });

  it("ignores a blank substring query", () => {
    expect(substringPositions("a b", " ").size).toBe(0);
    expect(substringPositions("a b", undefined).size).toBe(0);
  });
});
