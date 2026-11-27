// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

/** How long a download may take to start reading its Blob before the URL is revoked */
const REVOKE_AFTER_MS = 60_000;

// extra boundary added for jest testing, since jsdom's Blob doesn't support .text()
export function downloadTextFile(text: string, fileName: string): void {
  downloadFiles([{ blob: new Blob([text]), fileName }]);
}

export function downloadFiles(files: { blob: Blob; fileName: string }[]): void {
  const body = document.body;

  const link = document.createElement("a");
  link.style.display = "none";
  body.appendChild(link);

  const urls = files.map((file) => {
    // oxlint-disable-next-line @lichtblick/no-object-url -- revoked below after the click
    const url = window.URL.createObjectURL(file.blob);
    link.setAttribute("download", file.fileName);
    link.setAttribute("href", url);
    link.click();
    return url;
  });

  body.removeChild(link);
  // The download reads the Blob after the click returns, for a while with a large file. A timer,
  // not requestAnimationFrame: that never fires in a hidden tab, which would keep the Blob forever.
  setTimeout(() => {
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
  }, REVOKE_AFTER_MS);
}
