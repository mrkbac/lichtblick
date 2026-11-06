/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import "@testing-library/jest-dom/vitest";

import {
  convertEulerDegrees,
  FrameOffset,
  RotationConvention,
  rpyDegreesToQuat,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/transformOffsets";

import { OffsetEditor } from "./OffsetEditor";

function setup(offset?: FrameOffset, convention: RotationConvention = "extrinsic") {
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
      convention={convention}
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
    // Given: a frame pitched 60 deg in the recording, without an offset
    const { onChange } = setup();

    // When
    fireEvent.change(screen.getByLabelText("Result Pitch (°)"), { target: { value: "61" } });

    // Then
    const offset = onChange.mock.lastCall?.[0] as FrameOffset;
    expect(offset.xyz).toEqual([0, 0, 0]);
    expect(offset.rpy[1]).toBeCloseTo(1, 6);
  });

  it("shows the result of an existing offset and resets it", () => {
    // Given
    const { onChange } = setup({ xyz: [0.5, 0, 0], rpy: [0, 0, 0] });
    expect(screen.getByLabelText("Result x (m)")).toHaveValue(1.5);

    // When
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    // Then
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  const shownOffsetRpy = () =>
    ["Offset Roll (°)", "Offset Pitch (°)", "Offset Yaw (°)"].map((label) =>
      Number(screen.getByLabelText<HTMLInputElement>(label).value),
    );

  it("shows the stored offset angles as they are in the intrinsic convention", () => {
    // Given / When: an intrinsic roll 10, pitch 20 offset
    setup({ xyz: [0, 0, 0], rpy: [10, 20, 0] }, "intrinsic");

    // Then
    expect(shownOffsetRpy()).toEqual([10, 20, 0]);
  });

  it("shows and takes offset angles in the extrinsic convention, stored as intrinsic XYZ", () => {
    // Given: an intrinsic roll 10, pitch 20 offset, shown as extrinsic (ROS) angles
    const { onChange } = setup({ xyz: [0, 0, 0], rpy: [10, 20, 0] }, "extrinsic");
    const extrinsic = convertEulerDegrees([10, 20, 0], "intrinsic", "extrinsic");
    shownOffsetRpy().forEach((value, i) => {
      expect(value).toBeCloseTo(extrinsic[i]!, 3);
    });

    // When: the extrinsic roll is raised by 1
    fireEvent.change(screen.getByLabelText("Offset Roll (°)"), {
      target: { value: String(extrinsic[0] + 1) },
    });

    // Then: stored as the matching intrinsic angles
    const expected = convertEulerDegrees(
      [extrinsic[0] + 1, extrinsic[1], extrinsic[2]],
      "extrinsic",
      "intrinsic",
    );
    const stored = (onChange.mock.lastCall?.[0] as FrameOffset).rpy;
    stored.forEach((value, i) => {
      expect(value).toBeCloseTo(expected[i]!, 3);
    });
  });
});
