/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";

import JsonInput from "@lichtblick/suite-base/components/JsonInput";

describe("JsonInput", () => {
  it("shows the value as formatted JSON", () => {
    render(<JsonInput value={{ a: 1 }} dataTestId="json" />);
    expect(screen.getByTestId<HTMLTextAreaElement>("json").value).toBe('{\n  "a": 1\n}');
  });

  it("calls onChange only with valid JSON and shows parse errors", () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<JsonInput value={{}} dataTestId="json" onChange={onChange} onError={onError} />);
    const input = screen.getByTestId("json");

    fireEvent.change(input, { target: { value: "{ bad" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '{"b": 2}' } });
    expect(onChange).toHaveBeenLastCalledWith({ b: 2 });
  });

  it("is read-only when asked", () => {
    render(<JsonInput value={[1]} dataTestId="json" readOnly />);
    expect(screen.getByTestId<HTMLTextAreaElement>("json").readOnly).toBe(true);
  });
});
