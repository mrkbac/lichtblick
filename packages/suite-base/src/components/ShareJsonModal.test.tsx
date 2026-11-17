/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";

import { ShareJsonModal } from "@lichtblick/suite-base/components/ShareJsonModal";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

describe("ShareJsonModal", () => {
  it.each(["null", "5", "[]"])("does not apply non-object JSON %s", (text) => {
    const onChange = vi.fn();
    render(
      <ThemeProvider isDark={false}>
        <ShareJsonModal title="t" initialValue={{}} onChange={onChange} onRequestClose={vi.fn()} />
      </ThemeProvider>,
    );
    fireEvent.change(screen.getByTestId("share-json-input"), { target: { value: text } });
    fireEvent.click(screen.getByText("Apply"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
