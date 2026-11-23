// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@lichtblick/suite";
import {
  getChartValue,
  isChartValue,
  resolveChartDatum,
} from "@lichtblick/suite-base/panels/Plot/utils/datum";
import { BasicBuilder } from "@lichtblick/test-builders";

describe("Chart Value Utilities", () => {
  describe("isChartValue", () => {
    it("should return true if value is null", () => {
      expect(isChartValue(null)).toBe(true);
    });
    it("should return true for valid types: bigint, boolean, number, string", () => {
      expect(isChartValue(42n)).toBe(true);
      expect(isChartValue(true)).toBe(true);
      expect(isChartValue(3.14)).toBe(true);
      expect(isChartValue(BasicBuilder.string())).toBe(true);
    });

    it("should return true for Time objects, ROS 2 ones too", () => {
      const time: Time = { sec: 10, nsec: 500 };
      expect(isChartValue(time)).toBe(true);
      expect(isChartValue({ sec: 10, nanosec: 500 })).toBe(true);
    });

    it("should return false for unsupported object types", () => {
      expect(isChartValue({})).toBe(false);
    });

    it("should return false for unsupported types", () => {
      expect(isChartValue(undefined)).toBe(false);
      expect(isChartValue(Symbol(BasicBuilder.string()))).toBe(false);
      expect(isChartValue(() => {})).toBe(false);
    });
  });

  describe("getChartValue", () => {
    it("should return NaN when value is null", () => {
      expect(getChartValue(null)).toBeNaN();
    });
    it("should correctly convert bigint, boolean, number, and string", () => {
      expect(getChartValue(42n)).toBe(42);
      expect(getChartValue(true)).toBe(1);
      expect(getChartValue(false)).toBe(0);
      expect(getChartValue(3.14)).toBe(3.14);
      expect(getChartValue("42")).toBe(42);
      expect(getChartValue("3.14")).toBe(3.14);
      expect(getChartValue("not-a-number")).toBeNaN();
      expect(getChartValue("")).toBeNaN();
      expect(getChartValue("  ")).toBeNaN();
    });

    it("should return seconds for Time objects, ROS 2 ones too", () => {
      expect(getChartValue({ sec: 10, nsec: 5e8 })).toBe(10.5);
      expect(getChartValue({ sec: 10, nanosec: 5e8 })).toBe(10.5);
    });

    it("should return undefined for unsupported object types", () => {
      expect(getChartValue({})).toBeUndefined();
    });

    it("should return undefined for unsupported types", () => {
      expect(getChartValue(undefined)).toBeUndefined();
      expect(getChartValue(Symbol(BasicBuilder.string()))).toBeUndefined();
      expect(getChartValue(() => {})).toBeUndefined();
    });
  });

  describe("resolveChartDatum", () => {
    it("should return undefined for unsupported types", () => {
      expect(resolveChartDatum(undefined)).toBeUndefined();
      expect(resolveChartDatum(Symbol(BasicBuilder.string()))).toBeUndefined();
      expect(resolveChartDatum(() => {})).toBeUndefined();
    });

    it("should map a null item to a gap", () => {
      expect(resolveChartDatum(null)).toEqual({ y: NaN, value: null });
    });

    it("should resolve a numeric item", () => {
      const value = 3.14;

      expect(resolveChartDatum(value)).toEqual({ y: value, value });
    });

    it("should map a value that resolves to NaN to a null value", () => {
      expect(resolveChartDatum("not-a-number")).toEqual({ y: NaN, value: null });
    });

    it("should keep ROS 2 stamps as Time, so legend, hover and copy can read them", () => {
      expect(resolveChartDatum({ sec: 10, nanosec: 5e8 })).toEqual({
        y: 10.5,
        value: { sec: 10, nsec: 5e8 },
      });
    });

    it("should resolve Time objects to seconds", () => {
      const time: Time = { sec: 10, nsec: 5e8 };
      expect(resolveChartDatum(time)).toEqual({ y: 10.5, value: time });
    });
  });
});
