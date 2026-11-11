/* oxlint-disable @lichtblick/license-header -- New fork files must not claim BMW copyright. */
// SPDX-License-Identifier: MPL-2.0

import satisfies from "spdx-satisfies";

const ALLOWED_LICENSES = [
  "MPL-2.0",
  "MIT",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD-4-Clause",
  "Apache-2.0",
  "ISC",
  "Python-2.0",
  "PSF-2.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "WTFPL",
  "Unlicense",
  "OFL-1.1",
  "BlueOak-1.0.0",
  "Zlib",
];

/** Accept approved alternatives; invalid expressions and unapproved requirements fail closed. */
export function isLicenseAllowed(license: string): boolean {
  if (license === "Public Domain") {
    return true;
  }
  try {
    return satisfies(license, ALLOWED_LICENSES);
  } catch {
    return false;
  }
}
