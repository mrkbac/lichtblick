/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import PlaybackSpeedControls, {
  formatSpeed,
  roundSpeed,
  stepSpeed,
} from "@lichtblick/suite-base/components/PlaybackSpeedControls";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";

describe("Given PlaybackSpeedControls", () => {
  const renderWithProviders = (activeData?: { speed?: number }) => {
    return render(
      <MockCurrentLayoutProvider>
        <MockMessagePipelineProvider
          activeData={activeData}
          capabilities={[PLAYER_CAPABILITIES.setSpeed]}
        >
          <PlaybackSpeedControls />
        </MockMessagePipelineProvider>
      </MockCurrentLayoutProvider>,
    );
  };

  it("When speed is set to 1 Then correctly displays the speed value", () => {
    renderWithProviders({ speed: 1 });

    expect(screen.getByText("1×")).toBeInTheDocument();
  });

  it("When speed is set to 0.05 Then correctly displays the speed value", () => {
    renderWithProviders({ speed: 0.05 });

    expect(screen.getByText("0.05×")).toBeInTheDocument();
  });

  it("When hovered Then displays tooltip", () => {
    renderWithProviders({ speed: 1 });

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("title", "Playback speed (scroll to change)");
  });

  it("When clicked Then opens popover with slider, steppers and presets", () => {
    renderWithProviders({ speed: 1 });

    fireEvent.click(screen.getByTestId("PlaybackSpeedControls-Dropdown"));

    expect(screen.getByRole("slider", { name: "Playback speed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slower" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faster" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0.5×" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1×", pressed: true })).toBeInTheDocument();
  });

  it("When the slider moves Then the thumb follows before the player echoes the speed", () => {
    renderWithProviders({ speed: 1 });
    fireEvent.click(screen.getByTestId("PlaybackSpeedControls-Dropdown"));

    const slider = screen.getByRole("slider", { name: "Playback speed" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });

    // The mock player never echoes the new speed; the control must not snap back to 1×.
    expect(slider).toHaveAttribute("aria-valuetext", "0.98×");
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown")).toHaveTextContent("0.98×");
  });
});

describe("Given the speed button", () => {
  it("When scrolled Then steps through presets, ignoring small trackpad deltas", () => {
    render(
      <MockCurrentLayoutProvider>
        <MockMessagePipelineProvider
          activeData={{ speed: 1 }}
          capabilities={[PLAYER_CAPABILITIES.setSpeed]}
        >
          <PlaybackSpeedControls />
        </MockMessagePipelineProvider>
      </MockCurrentLayoutProvider>,
    );
    const button = screen.getByTestId("PlaybackSpeedControls-Dropdown");

    fireEvent.wheel(button, { deltaY: -100 });
    expect(button).toHaveTextContent("2×");

    fireEvent.wheel(button, { deltaY: 20 });
    expect(button).toHaveTextContent("2×");
    fireEvent.wheel(button, { deltaY: 40 });
    expect(button).toHaveTextContent("1×");
  });
});

describe("speed helpers", () => {
  it("rounds slider values to 2 significant digits within range", () => {
    expect(roundSpeed(0.3712)).toBe(0.37);
    expect(roundSpeed(1.234)).toBe(1.2);
    expect(roundSpeed(0.001)).toBe(0.01);
    expect(roundSpeed(500)).toBe(100);
  });

  it("steps to the neighbouring preset from any value", () => {
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(1, -1)).toBe(0.8);
    expect(stepSpeed(1.3, 1)).toBe(2);
    expect(stepSpeed(1.3, -1)).toBe(1);
    expect(stepSpeed(100, 1)).toBe(100);
  });

  it("formats speeds", () => {
    expect(formatSpeed(0.05)).toBe("0.05×");
    expect(formatSpeed(1)).toBe("1×");
    expect(formatSpeed(0.37)).toBe("0.37×");
  });
});
