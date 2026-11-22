// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { unwrap } from "@lichtblick/den/monads";
import { parseMessagePath } from "@lichtblick/message-path";
import { MAX_POINTS } from "@lichtblick/suite-base/components/TimeBasedChart/downsample";

import { CustomDatasetsBuilderImpl, ValueItem } from "./CustomDatasetsBuilderImpl";
import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";

const key = "0" as SeriesConfigKey;

function build(overrides: Partial<SeriesItem> = {}, budget?: number): CustomDatasetsBuilderImpl {
  const builder = new CustomDatasetsBuilderImpl(budget);
  builder.updateData([
    {
      type: "update-series-config",
      seriesItems: [
        {
          configIndex: 0,
          key,
          messagePath: "/b.y",
          parsed: unwrap(parseMessagePath("/b.y")),
          color: "red",
          contrastColor: "blue",
          enabled: true,
          timestampMethod: "receiveTime",
          lineSize: 1,
          showLine: true,
          ...overrides,
        },
      ],
    },
  ]);
  return builder;
}

/** One value per message, received at `t` seconds */
const values = (times: number[], value: (t: number) => number): ValueItem[] =>
  times.map((t) => ({
    value: value(t),
    originalValue: value(t),
    receiveTime: { sec: Math.floor(t), nsec: Math.round((t % 1) * 1e9) },
  }));

const viewport = { size: { width: 1000, height: 500 }, bounds: {} };
const pairs = (builder: CustomDatasetsBuilderImpl) =>
  builder.getViewportDatasets(viewport).datasetsByConfigIndex[0]!.data.map(({ x, y }) => [x, y]);

describe("CustomDatasetsBuilderImpl", () => {
  it("pairs x and y by receive time when the topics drop different messages", () => {
    // GIVEN x has a message at t=1 that y does not
    const builder = build();
    builder.updateData([
      { type: "append-full-x", items: values([0, 1, 2, 3], (t) => t) },
      { type: "append-full", series: key, items: values([0, 2, 3], (t) => 10 * t) },
    ]);

    // THEN every y value pairs with the x value of its own time
    expect(pairs(builder)).toEqual([
      [0, 0],
      [2, 20],
      [3, 30],
    ]);
    expect(builder.getViewportDatasets(viewport).pathsWithMismatchedDataLengths.size).toBe(0);
  });

  it("pairs a y value with the last x value before it on another topic", () => {
    const builder = build();
    builder.updateData([
      { type: "append-current-x", items: values([0, 1], (t) => t) },
      { type: "append-current", series: key, items: values([0.5, 1.5], (t) => t) },
    ]);
    expect(pairs(builder)).toEqual([
      [0, 0.5],
      [1, 1.5],
    ]);
  });

  it("pairs again when x values for a newer time arrive after the y values", () => {
    // GIVEN y at t=2 is read before x has caught up
    const builder = build();
    builder.updateData([
      { type: "append-full-x", items: values([0, 1], (t) => t) },
      { type: "append-full", series: key, items: values([0, 1, 2], (t) => t) },
    ]);
    expect(pairs(builder).at(-1)).toEqual([1, 2]);

    // WHEN the x value for t=2 arrives
    builder.updateData([{ type: "append-full-x", items: values([2], (t) => 100 + t) }]);

    // THEN the row is paired with it, and earlier pairs stay
    expect(pairs(builder)).toEqual([
      [0, 0],
      [1, 1],
      [102, 2],
    ]);
  });

  it("pairs arrays by index within the message", () => {
    const builder = build();
    const at = (value: number, t = 0) => ({
      value,
      originalValue: value,
      receiveTime: { sec: t, nsec: 0 },
    });
    builder.updateData([
      { type: "append-current-x", items: [at(1), at(2), at(3), at(4, 1), at(5, 1)] },
      { type: "append-current", series: key, items: [at(10), at(20), at(30), at(40, 1)] },
    ]);
    expect(pairs(builder)).toEqual([
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
    ]);
    // the second message has two x values and one y value
    expect(builder.getViewportDatasets(viewport).pathsWithMismatchedDataLengths.size).toBe(1);
  });

  it("downsamples lines to what the viewport can show, keeping both ends", () => {
    // GIVEN a dense circle walked 20 times
    const builder = build({ xPath: "/b.x", xParsed: unwrap(parseMessagePath("/b.x")) });
    const n = 200_000;
    const items: ValueItem[] = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * 40 * Math.PI;
      items.push({
        x: Math.cos(angle),
        value: Math.sin(angle),
        originalValue: Math.sin(angle),
        receiveTime: { sec: i, nsec: 0 },
      });
    }
    builder.updateData([{ type: "append-full", series: key, items }]);

    const data = builder.getViewportDatasets(viewport).datasetsByConfigIndex[0]!.data;
    expect(data.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(data.length).toBeGreaterThan(100);
    expect(data[0]).toMatchObject({ x: 1, y: 0 });
    expect(data.at(-1)!.x).toBeCloseTo(Math.cos(((n - 1) / n) * 40 * Math.PI));
  });

  it("thins live data evenly under the budget and keeps x and y of a message together", () => {
    // GIVEN x and y from the same topic and a budget of 1000 rows
    const builder = build({}, 1000);
    for (let start = 0; start < 20_000; start += 100) {
      const times = Array.from({ length: 100 }, (_, i) => (start + i) / 100);
      builder.updateData([
        { type: "append-current-x", items: values(times, (t) => t) },
        { type: "append-current", series: key, items: values(times, (t) => 10 * t) },
      ]);
    }

    // THEN the whole time range is kept within budget, newest included, all pairs right
    const data = pairs(builder);
    expect(data.length).toBeLessThanOrEqual(500);
    expect(data.length).toBeGreaterThan(100);
    expect(data[0]).toEqual([0, 0]);
    expect(data.at(-1)).toEqual([199.99, 1999.9]);
    for (const [x, y] of data) {
      expect(y).toBeCloseTo(10 * x!);
    }
  });
});
