/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, fireEvent } from "@testing-library/react";

import DirectionalPad from "@lichtblick/suite-base/panels/Teleop/DirectionalPad";
import { DirectionalPadAction } from "@lichtblick/suite-base/panels/Teleop/types";

describe("DirectionalPad", () => {
  it("should call onAction and update state when UP button is clicked", () => {
    // given
    const onAction = vi.fn();
    const { container } = render(<DirectionalPad onAction={onAction} />);
    const upButton = container.querySelector('g[role="button"]');

    // when
    fireEvent.pointerDown(upButton!);

    // then
    expect(onAction).toHaveBeenCalledWith(DirectionalPadAction.UP);

    // when
    fireEvent.pointerUp(upButton!);

    // then
    expect(onAction).toHaveBeenLastCalledWith();
  });

  it("should highlight the buttons matching the vector", () => {
    const { container } = render(<DirectionalPad vector={{ x: -0.5, y: 1 }} />);
    const buttons = container.querySelectorAll('g[role="button"]');
    const active = [...buttons].map((button) => button.querySelector(".active") != undefined);
    // up, down, left, right
    expect(active).toEqual([true, false, true, false]);
  });

  it("should not call onAction when disabled", () => {
    // given
    const onAction = vi.fn();
    const { container } = render(<DirectionalPad onAction={onAction} disabled={true} />);
    const upButton = container.querySelector('g[role="button"]');

    // when
    fireEvent.pointerDown(upButton!);

    // then
    expect(onAction).not.toHaveBeenCalled();
    expect(upButton?.parentElement?.querySelector(".active")).toBeFalsy();
  });

  it("should handle case when onAction is not provided", () => {
    // given
    const { container } = render(<DirectionalPad />);
    const upButton = container.querySelector('g[role="button"]');

    // when
    fireEvent.pointerDown(upButton!);

    // then
    // No error should be thrown
    expect(upButton).toBeTruthy();
  });

  it("should update state for different directional actions", () => {
    // given
    const onAction = vi.fn();
    const { container } = render(<DirectionalPad onAction={onAction} />);
    const buttons = container.querySelectorAll('g[role="button"]');

    // when/then
    const actions = [
      DirectionalPadAction.UP,
      DirectionalPadAction.DOWN,
      DirectionalPadAction.LEFT,
      DirectionalPadAction.RIGHT,
    ];

    buttons.forEach((button, index) => {
      fireEvent.pointerDown(button);
      expect(onAction).toHaveBeenCalledWith(actions[index]);
      fireEvent.pointerUp(button);
    });
  });
});
