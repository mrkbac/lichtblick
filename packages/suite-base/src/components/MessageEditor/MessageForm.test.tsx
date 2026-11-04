/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import { MessageForm } from "./MessageForm";

const datatypes: RosDatatypes = new Map([
  [
    "pkg/Goal",
    {
      definitions: [
        { name: "MODE_IDLE", type: "uint8", isConstant: true, value: 0 },
        { name: "MODE_RUN", type: "uint8", isConstant: true, value: 1 },
        { name: "mode", type: "uint8" },
        { name: "label", type: "string" },
        { name: "enabled", type: "bool" },
        { name: "values", type: "float64", isArray: true },
        { name: "points", type: "pkg/Point", isArray: true, isComplex: true },
      ],
    },
  ],
  ["pkg/Point", { definitions: [{ name: "x", type: "float64" }] }],
]);

function setup(value: Record<string, unknown>) {
  const onChange = jest.fn();
  const onInvalidFieldsChange = jest.fn();
  render(
    <ThemeProvider isDark={false}>
      <MessageForm
        datatypes={datatypes}
        schemaName="pkg/Goal"
        value={value}
        onChange={onChange}
        onInvalidFieldsChange={onInvalidFieldsChange}
      />
    </ThemeProvider>,
  );
  return { onChange, onInvalidFieldsChange };
}

const base = { mode: 1, label: "a", enabled: false, values: [1, 2], points: [{ x: 1 }] };

describe("MessageForm", () => {
  it("shows the constant name of enum values", () => {
    setup(base);
    expect(screen.getByText("uint8 · MODE_RUN")).toBeInTheDocument();
  });

  it("edits strings and booleans", async () => {
    const { onChange } = setup(base);
    fireEvent.change(screen.getByLabelText("label"), { target: { value: "b" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...base, label: "b" });
    await userEvent.click(screen.getByLabelText("enabled"));
    expect(onChange).toHaveBeenLastCalledWith({ ...base, enabled: true });
  });

  it("edits primitive arrays as JSON", () => {
    const { onChange } = setup(base);
    fireEvent.change(screen.getByLabelText("values"), { target: { value: "[3]" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...base, values: [3] });
    fireEvent.change(screen.getByLabelText("values"), { target: { value: "{}" } });
    expect(screen.getByText("Expected a JSON array")).toBeInTheDocument();
  });

  it("reports invalid field drafts that are not in the message yet", () => {
    // Given
    const { onInvalidFieldsChange } = setup(base);

    // When
    fireEvent.change(screen.getByLabelText("values"), { target: { value: "[1," } });

    // Then
    expect(onInvalidFieldsChange).toHaveBeenLastCalledWith(1);

    // When
    fireEvent.change(screen.getByLabelText("values"), { target: { value: "[1]" } });

    // Then
    expect(onInvalidFieldsChange).toHaveBeenLastCalledWith(0);
  });

  it("adds and removes complex array items", async () => {
    const { onChange } = setup(base);
    await userEvent.click(screen.getByLabelText("Add points item"));
    expect(onChange).toHaveBeenLastCalledWith({ ...base, points: [{ x: 1 }, { x: 0 }] });
    await userEvent.click(screen.getByLabelText("Remove points item 0"));
    expect(onChange).toHaveBeenLastCalledWith({ ...base, points: [] });
  });
});
