/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen, fireEvent } from "@testing-library/react";
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
  const renderButton = () => {
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
    return screen.getByTestId("PlaybackSpeedControls-Dropdown");
  };

  it("When scrolled Then steps through presets, ignoring small trackpad deltas", () => {
    const button = renderButton();

    fireEvent.wheel(button, { deltaY: -100 });
    expect(button).toHaveTextContent(/^2×$/);

    fireEvent.wheel(button, { deltaY: 20 });
    expect(button).toHaveTextContent(/^2×$/);
    fireEvent.wheel(button, { deltaY: 40 });
    expect(button).toHaveTextContent(/^1×$/);
  });

  it("When scrolled in a burst before re-rendering Then every notch counts", () => {
    const button = renderButton();

    act(() => {
      button.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
      button.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
    });

    expect(button).toHaveTextContent(/^3×$/);
  });

  it("When the wheel reports lines instead of pixels Then each notch is one step", () => {
    const button = renderButton();

    fireEvent.wheel(button, { deltaY: -3, deltaMode: 1 });

    expect(button).toHaveTextContent(/^2×$/);
  });

  it("When ctrl+scrolled (browser zoom) Then the speed and the page zoom are left alone", () => {
    const button = renderButton();

    const event = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true });
    act(() => {
      button.dispatchEvent(event);
    });

    expect(button).toHaveTextContent(/^1×$/);
    expect(event.defaultPrevented).toBe(false);
  });

  it("When Faster is pressed twice before the player echoes Then it steps from the shown speed", () => {
    const button = renderButton();
    fireEvent.click(button);

    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));

    expect(button).toHaveTextContent(/^3×$/);
  });

  it("When ArrowRight is pressed repeatedly at 1× Then the slider keeps advancing", () => {
    const button = renderButton();
    fireEvent.click(button);
    const slider = screen.getByRole("slider", { name: "Playback speed" });

    // One key step (0.01 in log space) still rounds to 1×; the steps must accumulate.
    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(slider, { key: "ArrowRight" });
    }

    expect(slider).toHaveAttribute("aria-valuetext", "1.1×");
  });
});

describe("Given the speed helpers", () => {
  it("When rounding a slider value Then it keeps 2 significant digits", () => {
    expect(roundSpeed(0.3712)).toBe(0.37);
    expect(roundSpeed(1.234)).toBe(1.2);
  });

  it("When rounding outside 0.01×–100× Then it clamps to the range", () => {
    expect(roundSpeed(0.001)).toBe(0.01);
    expect(roundSpeed(500)).toBe(100);
  });

  it("When stepping from a preset Then it lands on the neighbouring preset", () => {
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(1, -1)).toBe(0.8);
  });

  it("When stepping from a value between presets Then it lands on the nearest preset that way", () => {
    expect(stepSpeed(1.3, 1)).toBe(2);
    expect(stepSpeed(1.3, -1)).toBe(1);
  });

  it("When stepping past 100× Then it stays at 100×", () => {
    expect(stepSpeed(100, 1)).toBe(100);
  });

  it("When formatting Then it shows up to 3 significant digits and ×", () => {
    expect(formatSpeed(0.05)).toBe("0.05×");
    expect(formatSpeed(1)).toBe("1×");
    expect(formatSpeed(0.37)).toBe("0.37×");
  });
});
