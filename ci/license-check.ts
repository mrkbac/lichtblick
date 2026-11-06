// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { execFileSync } from "node:child_process";

// A license passes if it contains any of these (substring match, e.g. "BSD" covers "0BSD").
const ALLOWED_LICENSES = [
  "MPL-2.0",
  "MIT",
  "BSD",
  "Apache",
  "ISC",
  "Python-2.0",
  "PSF",
  "CC-BY",
  "CC0",
  "Public Domain",
  "WTFPL",
  "Unlicense",
  "OFL-1.1",
  "BlueOak-1.0.0",
];

// Reported as "Unknown" (no license field in package.json); their LICENSE file is the Unlicense.
// Pinned to the verified versions so a new version or a license change fails the check.
const UNKNOWN_LICENSE_EXCEPTIONS = ["fast-shallow-equal@1.0.0", "react-universal-interface@0.6.2"];

type PackageInfo = { name: string; versions: string[] };

const byLicense = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
) as Record<string, PackageInfo[]>;

let failed = false;
for (const [license, packages] of Object.entries(byLicense)) {
  const allowed = ALLOWED_LICENSES.some((allowedLicense) => license.includes(allowedLicense));
  for (const pkg of packages) {
    const excepted =
      license === "Unknown" &&
      pkg.versions.every((version) => UNKNOWN_LICENSE_EXCEPTIONS.includes(`${pkg.name}@${version}`));
    if (!allowed && !excepted) {
      console.error(`${pkg.name}@${pkg.versions.join(",")} has disallowed license "${license}"`);
      failed = true;
    }
  }
  console.log(`${license}: ${packages.length}`);
}

process.exitCode = failed ? 1 : 0;
