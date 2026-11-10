/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";

import { fuzzyPositions, HighlightChars, substringPositions } from "./HighlightChars";

const highlighted = (container: HTMLElement) =>
  [...container.querySelectorAll("mark")].map((el) => el.textContent);

describe("HighlightChars", () => {
  it("wraps matched runs and renders markup in the text as text", () => {
    // Given
    const str = "<b>Raw Messages</b>";

    // When
    const { container } = render(<HighlightChars str={str} indices={fuzzyPositions(str, "raw")} />);

    // Then
    expect(container.textContent).toBe(str);
    expect(container.querySelector("b")).toBeNull();
    expect(highlighted(container)).toEqual(["Raw"]);
  });

  it("renders plain text without a match", () => {
    // Given
    const indices = fuzzyPositions("Plot", "zzz");

    // When
    const { container } = render(<HighlightChars str="Plot" indices={indices} />);

    // Then
    expect(container.textContent).toBe("Plot");
    expect(highlighted(container)).toEqual([]);
  });

  it("applies the offset to indices", () => {
    // Given
    const indices = new Set([3]);

    // When
    const { container } = render(<HighlightChars str="bar" indices={indices} offset={3} />);

    // Then
    expect(highlighted(container)).toEqual(["b"]);
  });

  it("highlights every substring occurrence case-insensitively", () => {
    // Given
    const str = "abc ABC abc";

    // When
    const { container } = render(
      <HighlightChars str={str} indices={substringPositions(str, "abc")} />,
    );

    // Then
    expect(highlighted(container)).toEqual(["abc", "ABC", "abc"]);
  });

  it("ignores a blank substring query", () => {
    // Given / When
    const blank = substringPositions("a b", " ");
    const missing = substringPositions("a b", undefined);

    // Then
    expect(blank.size).toBe(0);
    expect(missing.size).toBe(0);
  });
});
