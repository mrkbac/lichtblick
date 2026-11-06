/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Mock } from "vitest";

import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks/useAppConfigurationValue";
import { liveHistorySettings } from "@lichtblick/suite-base/players/liveHistory/liveHistorySettings";

import { AutoUpdate, LiveHistorySettings, StepSize } from "./settings";

vi.mock("@lichtblick/suite-base/hooks/useAppConfigurationValue", () => ({
  useAppConfigurationValue: vi.fn(),
}));

describe("StepSize component", () => {
  const mockSetStepSize = vi.fn();

  beforeEach(() => {
    (useAppConfigurationValue as Mock).mockReturnValue([100, mockSetStepSize]);
    mockSetStepSize.mockClear();
  });

  it("renders the step size input field with default value", () => {
    render(<StepSize />);
    const input = screen.getByRole("spinbutton");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(100);
  });

  it("calls setStepSize when user types a new number", () => {
    render(<StepSize />);
    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "250" } });

    expect(mockSetStepSize).toHaveBeenCalledWith(250);
  });
});

describe("AutoUpdate component", () => {
  it("should render update.enable as false by default", () => {
    (useAppConfigurationValue as Mock).mockReturnValue([undefined, vi.fn()]);

    render(<AutoUpdate />);
    const input: HTMLInputElement = screen.getByRole("checkbox");
    expect(input.checked).toBe(false);
  });

  it("should render a checked checkbox when update.enable is true", () => {
    (useAppConfigurationValue as Mock).mockReturnValue([true, vi.fn()]);

    render(<AutoUpdate />);
    const input: HTMLInputElement = screen.getByRole("checkbox");
    expect(input.checked).toBe(true);
  });
});

describe("LiveHistorySettings component", () => {
  beforeEach(() => {
    liveHistorySettings.getState().setWindowSec(30);
    liveHistorySettings.getState().setMaxMiB(128);
  });

  it("shows and changes the saved history length and memory limit", () => {
    render(<LiveHistorySettings />);
    expect(screen.getByText("30 s")).toBeInTheDocument();
    expect(screen.getByText("128 MiB")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getAllByRole("combobox")[0]!);
    fireEvent.click(screen.getByRole("option", { name: "5 min" }));
    expect(liveHistorySettings.getState().windowSec).toBe(300);

    fireEvent.mouseDown(screen.getAllByRole("combobox")[1]!);
    fireEvent.click(screen.getByRole("option", { name: "1 GiB" }));
    expect(liveHistorySettings.getState().maxMiB).toBe(1024);
  });
});
