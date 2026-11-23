// SPDX-License-Identifier: MPL-2.0

import { resolveInside } from "./resolveInside";

// Zip slip is a Windows problem first: run the helper with Windows path rules on any host.
vi.mock("path", async () => {
  const { win32 } = await vi.importActual<typeof import("path")>("path");
  return { ...win32, default: win32 };
});

describe("resolveInside with Windows paths", () => {
  const root = "C:\\ext\\foo";

  it("allows paths inside the root with either separator", () => {
    expect(resolveInside(root, "a\\b.js")).toBe("C:\\ext\\foo\\a\\b.js");
    expect(resolveInside(root, "a/b.js")).toBe("C:\\ext\\foo\\a\\b.js");
    expect(resolveInside(root, "..foo")).toBe("C:\\ext\\foo\\..foo");
  });

  it.each([
    "..\\..\\x",
    "a\\..\\..\\x",
    "../x",
    "C:\\other\\x",
    "D:\\x",
    "D:x",
    "\\x",
    "\\\\server\\share\\x",
    "//server/share/x",
    "C:\\ext\\foobar",
    ".",
  ])("rejects %s", (segment) => {
    expect(() => resolveInside(root, segment)).toThrow("escapes");
  });
});
