/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { createTheme } from "@mui/material";
import { render, screen } from "@testing-library/react";

import { Inclinometer } from "./Inclinometer";
import { DEFAULT_CONFIG } from "./constants";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const config = { ...DEFAULT_CONFIG, displayMode: "roll" as const };

describe("Inclinometer", () => {
  it.each([
    [0, "success"],
    [20, "warning"],
    [30, "error"],
    [-30, "error"],
  ] as const)("colors the %s° readout as %s", (value, severity) => {
    render(<Inclinometer config={config} value={value} />);
    expect(screen.getByText(`${value.toFixed(1)}°`).getAttribute("fill")).toBe(
      createTheme().palette[severity].main,
    );
  });

  it("accepts numeric strings", () => {
    render(<Inclinometer config={config} value=" 12.5 " />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("roll: 12.5°");
  });

  it("leaves room for labels across a 90° range", () => {
    render(<Inclinometer config={{ ...config, angleRange: 90 }} value={0} />);
    expect(screen.getByRole("img").getAttribute("viewBox")).toBe("0 -40 320 380");
  });

  it("converts radians and preserves the signed readout beyond the display range", () => {
    const { container } = render(
      <Inclinometer config={{ ...config, angleUnit: "radians" }} value={-Math.PI / 3} />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("roll: -60.0°");
    expect(container.querySelector('[transform="rotate(40 160 150)"]')).not.toBeNull();
  });

  it("translates the pitch horizon instead of rotating it", () => {
    const { container } = render(
      <Inclinometer config={{ ...config, displayMode: "pitch" }} value={20} />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("pitch: 20.0°");
    expect(container.querySelector('[transform="translate(0 37.5)"]')).not.toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, "", "  ", "\t", undefined, null, false, "invalid"])(
    "shows no reading for %s",
    (value) => {
      const { container } = render(<Inclinometer config={config} value={value} />);
      expect(screen.getByRole("img").getAttribute("aria-label")).toBe("roll: —");
      expect(container.querySelector("[clip-path]")).toBeNull();
    },
  );

  it("rejects invalid thresholds without drawing a live horizon", () => {
    const { container } = render(
      <Inclinometer config={{ ...config, warningAngle: 50 }} value={0} />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("roll: — invalidAngles");
    expect(screen.getByText("invalidAngles")).toBeDefined();
    expect(container.querySelector("[clip-path]")).toBeNull();
  });
});
