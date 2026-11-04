/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ParameterValue } from "@lichtblick/suite";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";

import { ParameterEditor } from "./ParameterEditor";
import Parameters, { ParametersConfig } from "./index";
import { parametersToYaml } from "./utils";

// jsdom has no layout, so render every row
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    getItemKey,
  }: {
    count: number;
    getItemKey: (i: number) => string;
  }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: getItemKey(index),
        start: 0,
      })),
    getTotalSize: () => 0,
    measureElement: vi.fn(),
  }),
}));

const PARAMS = new Map<string, ParameterValue>([
  ["/arm/gain", 1.5],
  ["/arm/enabled", true],
  ["/arm/name", "left"],
  ["/camera/exposure", 10],
]);

function setup({
  parameters = PARAMS,
  config,
  canSet = true,
}: {
  parameters?: Map<string, ParameterValue>;
  config?: ParametersConfig;
  canSet?: boolean;
} = {}) {
  const setParameter = vi.fn();
  const fixture = {
    topics: [],
    frame: {},
    capabilities: [
      PLAYER_CAPABILITIES.getParameters,
      ...(canSet ? [PLAYER_CAPABILITIES.setParameters] : []),
    ],
    activeData: { parameters },
    setParameter,
  };
  render(
    <PanelSetup fixture={fixture}>
      <Parameters overrideConfig={config} />
    </PanelSetup>,
  );
  return { setParameter };
}

describe("Parameters panel", () => {
  it("shows a source-agnostic empty state without the parameters capability", () => {
    render(
      <PanelSetup fixture={{ topics: [], frame: {}, capabilities: [] }}>
        <Parameters />
      </PanelSetup>,
    );
    expect(screen.getByText(/data source that supports parameters/)).toBeInTheDocument();
  });

  it("renders a namespace tree and filters it", async () => {
    setup();
    expect(screen.getByText("arm")).toBeInTheDocument();
    expect(screen.getByText("exposure")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Filter parameters"), "expo");
    expect(screen.queryByText("gain")).not.toBeInTheDocument();
    expect(screen.getByText("exposure")).toBeInTheDocument();
  });

  it("shows an error for an invalid regex", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Use regular expression" }));
    await userEvent.type(screen.getByLabelText("Filter parameters"), "[[(");
    expect(screen.getByText(/Invalid regex/)).toBeInTheDocument();
  });

  it("collapses namespaces", async () => {
    setup();
    await userEvent.click(screen.getByText("arm"));
    expect(screen.queryByText("gain")).not.toBeInTheDocument();
    expect(screen.getByText("exposure")).toBeInTheDocument();
  });

  it("submits quick edits to different parameters without dropping any", async () => {
    const { setParameter } = setup();
    await userEvent.click(screen.getByRole("switch", { name: "/arm/enabled" }));
    await userEvent.type(screen.getByRole("textbox", { name: "/camera/exposure" }), "0{Enter}");

    expect(setParameter).toHaveBeenCalledWith("/arm/enabled", false);
    expect(setParameter).toHaveBeenCalledWith("/camera/exposure", 100);
  });

  it("shows values read-only without the setParameters capability", () => {
    setup({ canSet: false });
    expect(screen.queryByRole("textbox", { name: "/arm/name" })).not.toBeInTheDocument();
    expect(screen.getByText("left")).toBeInTheDocument();
  });

  it("compares with a snapshot and restores selected values", async () => {
    const snapshot = new Map<string, ParameterValue>([
      ["/arm/gain", 2],
      ["/arm/enabled", true],
      ["/arm/name", "left"],
      ["/old", "gone"],
    ]);
    const { setParameter } = setup({
      config: {
        snapshots: [{ name: "baseline", yaml: parametersToYaml(snapshot) }],
      },
    });

    await userEvent.click(screen.getByLabelText("Snapshots"));
    await userEvent.click(screen.getByText("baseline"));

    expect(screen.getByText(/1 changed, 1 added, 1 removed/)).toBeInTheDocument();
    // Only differences are shown by default
    expect(screen.queryByText("name")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Select /arm/gain" }));
    await userEvent.click(screen.getByRole("button", { name: "Restore 1" }));
    expect(setParameter).toHaveBeenCalledWith("/arm/gain", 2);
  });
});

describe("ParameterEditor", () => {
  it("submits on Enter, resets on Escape and validates", async () => {
    const onSubmit = vi.fn();
    render(<ParameterEditor name="p" value={1} onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "p" });

    await userEvent.type(input, "x{Escape}");
    expect(input).toHaveValue("1");

    await userEvent.type(input, "x{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Not a number")).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, "2.5{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("p", 2.5);
  });

  it("keeps an in-progress edit when the value updates", async () => {
    const { rerender } = render(<ParameterEditor name="p" value="a" onSubmit={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "p" });
    await userEvent.type(input, "b");
    rerender(<ParameterEditor name="p" value="remote" onSubmit={vi.fn()} />);
    expect(input).toHaveValue("ab");
  });

  it("edits bytes as hex and objects as JSON", () => {
    const onSubmit = vi.fn();
    render(
      <>
        <ParameterEditor name="bytes" value={new Uint8Array([0, 255])} onSubmit={onSubmit} />
        <ParameterEditor name="obj" value={{ a: 1 }} onSubmit={onSubmit} />
      </>,
    );
    const bytes = screen.getByRole("textbox", { name: "bytes" });
    expect(bytes).toHaveValue("00 ff");
    fireEvent.change(bytes, { target: { value: "80 01" } });
    fireEvent.keyDown(bytes, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("bytes", new Uint8Array([0x80, 1]));

    const obj = screen.getByRole("textbox", { name: "obj" });
    fireEvent.change(obj, { target: { value: '{"a":2}' } });
    fireEvent.keyDown(obj, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("obj", { a: 2 });
  });
});
