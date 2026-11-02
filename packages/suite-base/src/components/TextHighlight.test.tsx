/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import TextHighlight from "./TextHighlight";

describe("TextHighlight", () => {
  const highlighted = (container: HTMLElement) =>
    [...container.querySelectorAll("span span")].map((el) => el.textContent);

  it("wraps matched runs and renders markup in the text as text", () => {
    const { container } = render(
      <ThemeProvider isDark={false}>
        <TextHighlight targetStr="<b>Raw Messages</b>" searchText="raw" />
      </ThemeProvider>,
    );
    expect(container.textContent).toBe("<b>Raw Messages</b>");
    expect(container.querySelector("b")).toBeNull();
    expect(highlighted(container)).toEqual(["Raw"]);
  });

  it("renders plain text without a match", () => {
    const { container } = render(
      <ThemeProvider isDark={false}>
        <TextHighlight targetStr="Plot" searchText="zzz" />
      </ThemeProvider>,
    );
    expect(container.innerHTML).toBe("Plot");
  });
});
