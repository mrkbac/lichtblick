// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  getPlotMode,
  getTimeWindow,
  isReferenceLinePlotPathType,
  PlotConfig,
  yBound,
} from "./config";

describe("isReferenceLinePlotPathType", () => {
  it.each(["0", "1.2", "1e6"])("returns true for '%s'", (value) => {
    expect(
      isReferenceLinePlotPathType({ value, enabled: true, timestampMethod: "receiveTime" }),
    ).toBe(true);
  });

  it.each([
    "",
    "x",
    "x.y",
    ".y",
    '/tf{child_frame_id=="base_link"}',
    '"topic with spaces"."field with spaces"',
  ])("returns false for '%s'", (value) => {
    expect(
      isReferenceLinePlotPathType({ value, enabled: true, timestampMethod: "receiveTime" }),
    ).toBe(false);
  });
});

describe("getTimeWindow", () => {
  const base = { paths: [] } as unknown as PlotConfig;

  it("uses the configured time window", () => {
    expect(getTimeWindow({ ...base, timeWindow: "automatic", followingViewWidth: 5 })).toBe(
      "automatic",
    );
  });

  it("derives sliding from a follow width on older layouts", () => {
    expect(getTimeWindow({ ...base, followingViewWidth: 5, minXValue: 1 })).toBe("sliding");
  });

  it("derives fixed from x bounds on older layouts", () => {
    expect(getTimeWindow({ ...base, maxXValue: 5 })).toBe("fixed");
  });

  it("is automatic without any range settings", () => {
    expect(getTimeWindow(base)).toBe("automatic");
  });
});

describe("getPlotMode", () => {
  it("plots the time series on older layouts without a mode", () => {
    expect(getPlotMode({ xAxisVal: "timestamp" })).toBe("time");
  });

  it("uses the configured mode on time plots", () => {
    expect(getPlotMode({ xAxisVal: "timestamp", plotMode: "histogram" })).toBe("histogram");
  });

  it("ignores the mode when x is not time", () => {
    expect(getPlotMode({ xAxisVal: "custom", plotMode: "fft" })).toBe("time");
  });
});

describe("yBound", () => {
  it("reads numbers and numeric strings, and treats empty or invalid bounds as auto", () => {
    expect(yBound(5)).toBe(5);
    expect(yBound("-2.5")).toBe(-2.5);
    expect(yBound("")).toBeUndefined();
    expect(yBound(undefined)).toBeUndefined();
    expect(yBound("abc")).toBeUndefined();
  });
});
