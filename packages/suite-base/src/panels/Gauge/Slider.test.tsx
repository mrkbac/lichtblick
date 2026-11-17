/** @jest-environment jsdom */
// SPDX-License-Identifier: MPL-2.0

import { createTheme } from "@mui/material";
import { render, screen } from "@testing-library/react";

import { Slider } from "./Slider";
import { DEFAULT_CONFIG } from "./constants";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const config = { ...DEFAULT_CONFIG, displayMode: "slider" as const, minValue: 10, maxValue: 20 };
const label = () => screen.getByRole("img").getAttribute("aria-label");

describe("Slider", () => {
  it("shows the position across the limits", () => {
    const { container } = render(<Slider config={config} value=" 12.5 " />);
    expect(label()).toBe("12.5 (25%)");
    expect(container.querySelector("circle")?.getAttribute("cx")).toBe("90");
  });

  it.each([
    [5, "5.00", "belowLimit", 20],
    [25, "25.0", "aboveLimit", 300],
  ])("pins %s to the end and flags it", (value, readout, status, x) => {
    const { container } = render(<Slider config={config} value={value} />);
    expect(label()).toBe(`${readout} (${status})`);
    expect(screen.getByText(readout).getAttribute("fill")).toBe(createTheme().palette.error.main);
    expect(container.querySelector("circle")?.getAttribute("cx")).toBe(String(x));
  });

  it.each([NaN, "", undefined, "invalid"])("shows no marker for %s", (value) => {
    const { container } = render(<Slider config={config} value={value} />);
    expect(label()).toBe("—");
    expect(container.querySelector("circle")).toBeNull();
  });

  it("shows no marker when max is not above min", () => {
    const { container } = render(<Slider config={{ ...config, maxValue: 10 }} value={10} />);
    expect(container.querySelector("circle")).toBeNull();
  });
});

describe("Slider with cleared settings", () => {
  // A cleared number field in the settings sidebar stores undefined despite the config type.
  it.each(["minValue", "maxValue"])("renders without a marker when %s is cleared", (key) => {
    const { container } = render(<Slider config={{ ...config, [key]: undefined }} value={12} />);
    // The readout keeps its trailing zero so it doesn't change width as the value changes.
    expect(label()).toBe("12.0");
    expect(container.querySelector("circle")).toBeNull();
  });
});
