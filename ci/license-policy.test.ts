/* oxlint-disable @lichtblick/license-header -- New fork files must not claim BMW copyright. */
// SPDX-License-Identifier: MPL-2.0

import { expect, it } from "vitest";

import { isLicenseAllowed } from "./license-policy.ts";

for (const license of [
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "Public Domain",
  "(MIT OR GPL-3.0-or-later)",
  "(MIT AND Zlib)",
]) {
  it(`allows ${license}`, () => {
    expect(isLicenseAllowed(license)).toBe(true);
  });
}
for (const license of [
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "(MIT AND GPL-3.0-only)",
  "GPL-3.0-only",
  "Unknown",
  "MIT OR NOT-A-LICENSE",
  "MIT WITH LLVM-exception",
]) {
  it(`rejects ${license}`, () => {
    expect(isLicenseAllowed(license)).toBe(false);
  });
}
