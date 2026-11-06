/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import "@testing-library/jest-dom/vitest";

import {
  FrameOffset,
  rpyDegreesToQuat,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/transformOffsets";

import { OffsetEditor } from "./OffsetEditor";

function setup(offset?: FrameOffset) {
  const onChange = vi.fn();
  render(
    <OffsetEditor
      frame="sensor"
      parent="base"
      // pitched 60 deg in the recording
      recorded={{ position: [1, 0, 2], rotation: rpyDegreesToQuat([0, 60, 0]) }}
      offset={offset}
      showOriginal={false}
      step="fine"
      onChange={onChange}
      onShowOriginalChange={vi.fn()}
      onStepChange={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { onChange };
}

describe("OffsetEditor", () => {
  it("computes the offset from a typed result: 60 deg recorded, 61 deg typed -> 1 deg", () => {
    const { onChange } = setup();

    fireEvent.change(screen.getByLabelText("Result Pitch (°)"), { target: { value: "61" } });

    const offset = onChange.mock.lastCall?.[0] as FrameOffset;
    expect(offset.xyz).toEqual([0, 0, 0]);
    expect(offset.rpy[1]).toBeCloseTo(1, 6);
  });

  it("shows the result of an existing offset and resets it", () => {
    const { onChange } = setup({ xyz: [0.5, 0, 0], rpy: [0, 0, 0] });

    expect(screen.getByLabelText("Result x (m)")).toHaveValue(1.5);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
