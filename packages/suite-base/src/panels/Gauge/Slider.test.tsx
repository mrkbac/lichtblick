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
    expect(container.querySelector("path")?.getAttribute("d")).toMatch(/^M 90 /);
  });

  it.each([
    [5, "belowLimit", 20],
    [25, "aboveLimit", 300],
  ])("pins %s to the end and flags it", (value, status, x) => {
    const { container } = render(<Slider config={config} value={value} />);
    expect(label()).toBe(`${value} (${status})`);
    expect(screen.getByText(String(value)).getAttribute("fill")).toBe(
      createTheme().palette.error.main,
    );
    expect(container.querySelector("path")?.getAttribute("d")).toMatch(new RegExp(`^M ${x} `));
  });

  it.each([NaN, "", undefined, "invalid"])("shows no marker for %s", (value) => {
    const { container } = render(<Slider config={config} value={value} />);
    expect(label()).toBe("—");
    expect(container.querySelector("path")).toBeNull();
  });

  it("shows no marker when max is not above min", () => {
    const { container } = render(<Slider config={{ ...config, maxValue: 10 }} value={10} />);
    expect(container.querySelector("path")).toBeNull();
  });
});
