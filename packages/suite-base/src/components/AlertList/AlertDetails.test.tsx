/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { AlertDetails } from "./AlertDetails";

function renderAlertDetails(details: unknown, tip?: string) {
  return render(
    <ThemeProvider isDark={false}>
      <AlertDetails details={details as string} tip={tip} />
    </ThemeProvider>,
  );
}

describe("AlertDetails", () => {
  it("renders the blocked-ws:// guide with its inline code, not the raw translation markup", async () => {
    render(
      <ThemeProvider isDark={false}>
        <AlertDetails
          details={undefined}
          tip="plain tip"
          guide={{ type: "wsMixedContent", url: "ws://robot.example:8765" }}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByText("ws://robot.example:8765")).toBeInTheDocument();
    expect(screen.getByText("Reload and retry")).toBeInTheDocument();
    expect(screen.queryByText(/<url\/>/)).not.toBeInTheDocument();
    expect(screen.queryByText("plain tip")).not.toBeInTheDocument();
  });

  it("shows a fallback message when details and tip are both empty", () => {
    // Given
    const details = undefined;

    // When
    renderAlertDetails(details);

    // Then
    expect(screen.getByText("No details provided")).toBeInTheDocument();
  });

  it("renders the error message when details is an Error", () => {
    // Given
    const error = new Error("Something went wrong");

    // When
    renderAlertDetails(error);

    // Then
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders string details as text", () => {
    // Given
    const details = "Connection timed out";

    // When
    renderAlertDetails(details);

    // Then
    expect(screen.getByText("Connection timed out")).toBeInTheDocument();
  });

  it("renders the tip when provided", () => {
    // Given
    const tip = "Try restarting the server";

    // When
    renderAlertDetails(undefined, tip);

    // Then
    expect(screen.getByText("Try restarting the server")).toBeInTheDocument();
  });
});
