/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import { makeStyles } from "tss-react/mui";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { HIDDEN_TAB_STYLE } from "./index";

const useStyles = makeStyles()({ hidden: HIDDEN_TAB_STYLE });

function HiddenTab(): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <div className={classes.hidden}>
      {/* Like a chart hover bar that shows itself with an inline style. */}
      <div data-testid="bar" style={{ visibility: "visible" }} />
    </div>
  );
}

describe("hidden tab", () => {
  it("hides descendants that set visibility: visible inline", () => {
    render(
      <ThemeProvider isDark={false}>
        <HiddenTab />
      </ThemeProvider>,
    );
    expect(getComputedStyle(screen.getByTestId("bar")).visibility).toBe("hidden");
  });
});
