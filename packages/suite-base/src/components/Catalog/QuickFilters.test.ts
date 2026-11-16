// SPDX-License-Identifier: MPL-2.0

import { toggleTerm } from "./QuickFilters";

describe("toggleTerm", () => {
  it("adds a missing term and removes a present one, keeping the rest", () => {
    expect(toggleTerm("", "has:gps")).toBe("has:gps");
    expect(toggleTerm("drive  topic:/cam", "has:gps")).toBe("drive topic:/cam has:gps");
    expect(toggleTerm("drive has:gps topic:/cam", "has:gps")).toBe("drive topic:/cam");
  });
});
