// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { buildThresholdFills } from "./thresholdFill";
import { Dataset } from "../types";

const data = [
  { x: 0, y: 1 },
  { x: 1, y: 3 },
];

describe("buildThresholdFills", () => {
  const primary: Dataset = { data, yAxisID: "y", stepped: "before" };
  const secondary: Dataset = { data: [{ x: 0, y: 5 }], yAxisID: "y2" };
  const empty: Dataset = { data: [] };

  it("adds nothing without shaded lines", () => {
    expect(buildThresholdFills([primary], undefined)).toEqual([]);
    expect(buildThresholdFills([primary], [{ value: 2, color: "#f00" }])).toEqual([]);
  });

  it("fills series on the line's axis above the line with the line color, reusing their data", () => {
    const fills = buildThresholdFills(
      [primary, secondary, empty],
      [{ value: 2, color: "#ff0000", scaleID: "y", shade: "above" }],
    );

    expect(fills).toHaveLength(1);
    expect(fills[0]!.data).toBe(data);
    expect(fills[0]).toMatchObject({
      yAxisID: "y",
      stepped: "before",
      parsing: false,
      borderWidth: 0,
      pointRadius: 0,
      pointHitRadius: 0,
      fill: { target: { value: 2 }, above: "#ff000040", below: "transparent" },
    });
  });

  it("shades below on the secondary axis", () => {
    const fills = buildThresholdFills(
      [primary, secondary],
      [{ value: 4, color: "#00ff00", scaleID: "y2", shade: "below" }],
    );

    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      yAxisID: "y2",
      fill: { target: { value: 4 }, above: "transparent", below: "#00ff0040" },
    });
  });

  it("shades only the chosen series, and one fill per shaded line", () => {
    const other: Dataset = { data: [{ x: 0, y: 0 }] };
    const fills = buildThresholdFills(
      [primary, other],
      [
        { value: 2, color: "#f00", shade: "above", shadeSeries: [1] },
        { value: -2, color: "#00f", shade: "below" },
      ],
    );

    expect(fills.map((fill) => fill.data)).toEqual([other.data, primary.data, other.data]);
  });

  it("ignores vertical lines", () => {
    expect(
      buildThresholdFills([primary], [{ value: 2, color: "#f00", scaleID: "x", shade: "above" }]),
    ).toEqual([]);
  });
});
