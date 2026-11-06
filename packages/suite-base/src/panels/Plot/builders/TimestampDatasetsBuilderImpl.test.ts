// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { unwrap } from "@lichtblick/den/monads";
import { parseMessagePath } from "@lichtblick/message-path";

import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";
import { DataItem, TimestampDatasetsBuilderImpl } from "./TimestampDatasetsBuilderImpl";

function seriesItem(
  key: string,
  overrides: Partial<SeriesItem> & { path?: string } = {},
): SeriesItem {
  const { path = "/topic.value", ...rest } = overrides;
  return {
    configIndex: Number(key),
    key: key as SeriesConfigKey,
    messagePath: path,
    parsed: unwrap(parseMessagePath(path)),
    color: "red",
    contrastColor: "blue",
    enabled: true,
    timestampMethod: "receiveTime",
    lineSize: 1,
    showLine: true,
    ...rest,
  };
}

const items = (xs: number[], y: (x: number) => number = (x) => x): DataItem[] =>
  xs.map((x) => ({
    x,
    y: y(x),
    value: y(x),
    receiveTime: { sec: x, nsec: 0 },
    headerStamp: { sec: x, nsec: 1 },
  }));

const range = (start: number, end: number): number[] =>
  Array.from({ length: end - start }, (_, i) => start + i);

function build(config: SeriesItem[]): TimestampDatasetsBuilderImpl {
  const builder = new TimestampDatasetsBuilderImpl();
  builder.applyAction({ type: "update-series-config", seriesItems: config });
  return builder;
}

const key = "0" as SeriesConfigKey;
const viewport = { size: { width: 1000, height: 500 }, bounds: {} };

describe("TimestampDatasetsBuilderImpl", () => {
  it("averages each sample with the samples before it", () => {
    // GIVEN five samples smoothed over 3 samples
    const builder = build([seriesItem("0", { smoothing: 3 })]);
    builder.applyAction({ type: "append-full", series: key, items: items([1, 2, 3, 4, 5]) });

    // THEN the window grows to 3 samples and then slides
    const data = builder.getCsvData()[0]!.data;
    expect(data.map((item) => item.y)).toEqual([1, 1.5, 2, 3, 4]);
    expect(data.map((item) => item.value)).toEqual([1, 1.5, 2, 3, 4]);
  });

  it("returns only the samples inside the requested x range", () => {
    const builder = build([seriesItem("0", { smoothing: 2 })]);
    builder.applyAction({ type: "append-full", series: key, items: items([1, 2, 3, 4, 5]) });

    const data = builder.getCsvData({ min: 2, max: 4 })[0]!.data;

    expect(data.map((item) => item.x)).toEqual([2, 3, 4]);
    // Derived values still use the samples before the range
    expect(data.map((item) => item.y)).toEqual([1.5, 2.5, 3.5]);
  });

  it("restarts the moving average window after a line break", () => {
    // GIVEN a NaN line break between two runs, smoothed over 2 samples
    const ys = [10, 20, NaN, 1, 3];
    const builder = build([seriesItem("0", { smoothing: 2 })]);
    builder.applyAction({
      type: "append-full",
      series: key,
      items: items([0, 1, 2, 3, 4], (x) => ys[x]!),
    });

    // WHEN reading the derived values
    // THEN the second run does not mix in values from the first
    expect(builder.getCsvData()[0]!.data.map((item) => item.y)).toEqual([10, 15, NaN, 1, 2]);
  });

  it("extends cached derived values on append like a full recompute", () => {
    // GIVEN a derivative with smoothing, loaded in several batches with redraws in between
    const config = [seriesItem("0", { path: "/topic.value.@derivative", smoothing: 4 })];
    const curve = (x: number) => x * x + (x % 7 === 0 ? NaN : 0);
    const incremental = build(config);
    for (let start = 0; start < 100; start += 10) {
      incremental.applyAction({
        type: "append-full",
        series: key,
        items: items(range(start, start + 10), curve),
      });
      incremental.getViewportDatasets(viewport);
    }
    incremental.applyAction({
      type: "append-current",
      series: key,
      items: items(range(100, 105), curve),
    });

    // WHEN compared with loading everything at once
    const once = build(config);
    once.applyAction({ type: "append-full", series: key, items: items(range(0, 100), curve) });
    once.applyAction({ type: "append-current", series: key, items: items(range(100, 105), curve) });

    // THEN derived values, tooltips and CSV match
    expect(incremental.getCsvData()).toEqual(once.getCsvData());
    expect(incremental.getViewportDatasets(viewport)).toEqual(once.getViewportDatasets(viewport));
  });

  it("recomputes derived values when the config changes", () => {
    // GIVEN a delta series
    const builder = build([seriesItem("0", { path: "/topic.value.@delta" })]);
    builder.applyAction({
      type: "append-full",
      series: key,
      items: items([0, 1, 3], (x) => x * 2),
    });
    expect(builder.getCsvData()[0]!.data.map((item) => item.value)).toEqual([null, 2, 4]);

    // WHEN the modifier changes, and then is removed
    // THEN the cached values are recomputed each time
    builder.applyAction({
      type: "update-series-config",
      seriesItems: [seriesItem("0", { path: "/topic.value.@timedelta" })],
    });
    expect(builder.getCsvData()[0]!.data.map((item) => item.value)).toEqual([null, 1, 2]);

    builder.applyAction({ type: "update-series-config", seriesItems: [seriesItem("0")] });
    expect(builder.getCsvData()[0]!.data.map((item) => item.value)).toEqual([0, 2, 6]);
  });

  it("merges out-of-order header stamp batches into sorted order", () => {
    // GIVEN header stamp batches that overlap and arrive out of order
    const builder = build([seriesItem("0", { timestampMethod: "headerStamp" })]);
    for (const batch of [
      [5, 1, 3],
      [2, 9],
      [0, 4, 4.5],
      [10, 3],
    ]) {
      builder.applyAction({ type: "append-full", series: key, items: items(batch) });
    }

    // THEN the rows are sorted, with every row's receive time and header stamp kept together
    const data = builder.getCsvData()[0]!.data;
    expect(data.map((item) => item.x)).toEqual([0, 1, 2, 3, 3, 4, 4.5, 5, 9, 10]);
    for (const item of data) {
      expect(item.receiveTime).toEqual({ sec: item.x, nsec: 0 });
      expect(item.headerStamp).toEqual({ sec: item.x, nsec: 1 });
    }
  });

  it("merges header stamp current data and drops what full data covers", () => {
    // GIVEN out-of-order current header stamp batches
    const builder = build([seriesItem("0", { timestampMethod: "headerStamp" })]);
    builder.applyAction({ type: "append-current", series: key, items: items([6, 4, 8]) });
    builder.applyAction({ type: "append-current", series: key, items: items([7, 5]) });
    // THEN they are merged in order
    expect(builder.getCsvData()[0]!.data.map((item) => item.x)).toEqual([4, 5, 6, 7, 8]);

    // WHEN full data up to x=6 arrives
    // THEN current rows it covers are dropped
    builder.applyAction({ type: "append-full", series: key, items: items([0, 6, 3]) });
    expect(builder.getCsvData()[0]!.data.map((item) => item.x)).toEqual([0, 3, 6, 7, 8]);
  });

  it("keeps original values that are not the plotted number", () => {
    // GIVEN values that are strings, bigints, gaps and plain numbers, without header stamps
    const builder = build([seriesItem("0")]);
    builder.applyAction({
      type: "append-full",
      series: key,
      items: [
        { x: 0, y: 1, value: "1", receiveTime: { sec: 0, nsec: 0 } },
        { x: 1, y: 2, value: 2n, receiveTime: { sec: 1, nsec: 0 } },
        { x: 2, y: NaN, value: null, receiveTime: { sec: 2, nsec: 0 } },
        { x: 3, y: 4, value: 4, receiveTime: { sec: 3, nsec: 0 } },
      ],
    });

    // WHEN exported
    const data = builder.getCsvData()[0]!.data;

    // THEN each original value and the missing header stamps come back unchanged
    expect(data.map((item) => item.value)).toEqual(["1", 2n, null, 4]);
    expect(data.map((item) => item.headerStamp)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("downsamples each series with its own budget and keeps spikes", () => {
    // GIVEN ten dense series, each with one spike
    const numSeries = 10;
    const builder = build(range(0, numSeries).map((i) => seriesItem(String(i))));
    for (let i = 0; i < numSeries; i++) {
      builder.applyAction({
        type: "append-full",
        series: String(i) as SeriesConfigKey,
        items: items(range(0, 100_000), (x) => (x === 50_000 + i ? 10 : x % 2 === 0 ? 1 : -1)),
      });
    }

    // WHEN drawn at 1500px
    const datasets = builder.getViewportDatasets({
      ...viewport,
      size: { width: 1500, height: 500 },
    });

    // THEN every series gets the full pixel budget (not a tenth of a shared one) and its spike
    for (let i = 0; i < numSeries; i++) {
      const data = datasets[i]!.data;
      expect(data.length).toBeGreaterThan(1000);
      expect(data.length).toBeLessThanOrEqual(2000);
      expect(data).toContainEqual({ x: 50_000 + i, y: 10, value: 10 });
      expect(datasets[i]!.pointRadius).toBe(0);
    }
  });

  it("keeps one point on either side of the zoomed range", () => {
    // GIVEN 100 points
    const builder = build([seriesItem("0")]);
    builder.applyAction({ type: "append-full", series: key, items: items(range(0, 100)) });

    // WHEN zoomed to x 10.5..20
    const data = builder.getViewportDatasets({
      ...viewport,
      bounds: { x: { min: 10.5, max: 20 } },
    })[0]!.data;

    // THEN the points in view plus one on each side are drawn
    expect(data.map((item) => item.x)).toEqual(range(10, 22));
  });

  it("plots the spectrum of the samples in the analyzed time range", () => {
    // GIVEN a 5 Hz sine sampled at 100 Hz for 2 s, then a 20 Hz sine for 2 s
    const builder = build([seriesItem("0")]);
    const xs = range(0, 400).map((i) => i / 100);
    builder.applyAction({
      type: "append-full",
      series: key,
      items: items(xs, (x) => Math.sin(2 * Math.PI * (x < 2 ? 5 : 20) * x)),
    });

    // WHEN analyzing only the first two seconds
    const dataset = builder.getViewportDatasets({
      ...viewport,
      analysis: { mode: "fft", timeRange: { min: 0, max: 1.99 } },
    })[0]!;

    // THEN the peak is at 5 Hz and the tooltip names the frequency
    const peak = dataset.data.reduce((a, b) => (b.y > a.y ? b : a));
    expect(peak.x).toBeCloseTo(5, 0);
    expect(peak.value).toMatch(/ @ 5(\.\d+)? Hz$/);
    expect(dataset.showLine).toBe(true);
    expect(dataset.pointRadius).toBe(0);
  });

  it("plots a histogram outline with the requested bin count", () => {
    const builder = build([seriesItem("0")]);
    builder.applyAction({
      type: "append-full",
      series: key,
      items: items([1, 2, 3, 4], (x) => (x < 3 ? -1 : 1)),
    });

    const data = builder.getViewportDatasets({
      ...viewport,
      analysis: { mode: "histogram", bins: 2 },
    })[0]!.data;

    expect(data.map(({ x, y }) => [x, y])).toEqual([
      [-1, 0],
      [-1, 2],
      [0, 2],
      [0, 2],
      [1, 2],
      [1, 0],
    ]);
    expect(data[1]!.value).toBe("2 in [-1, 0]");
  });
});
