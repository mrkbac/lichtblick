/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { clampLeftSidebarPercentage } from "@lichtblick/suite-base/components/Sidebars/utils";

describe("clampLeftSidebarPercentage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1000,
    });
  });
  it("should return the given percentage if it is greater than the minimum percentage", () => {
    const percentage = 50;
    const result = clampLeftSidebarPercentage(percentage);
    expect(result).toBe(50);
  });

  it("should return the minimum percentage if the given percentage is less", () => {
    const percentage = 1;
    const result = clampLeftSidebarPercentage(percentage);
    expect(result).toBeGreaterThan(percentage);
  });
});
