// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { TraceMark } from "./LichtblickLogo";

it("uses the same signal and sample geometry in the toolbar and app icon", () => {
  const icon = readFileSync(
    new URL("../../../suite-desktop/resources/icon/icon.svg", import.meta.url),
    "utf8",
  );
  const paths = (svg: string) =>
    Array.from(svg.matchAll(/<path\b[^>]*?\sd="([^"]+)"/g), ([, d]) => d);
  const mark = paths(renderToStaticMarkup(<TraceMark />));
  expect(mark).toHaveLength(3);
  expect(paths(icon)).toEqual(mark);
});
