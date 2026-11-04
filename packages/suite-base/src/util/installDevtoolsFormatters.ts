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

// Custom formatters for Chrome dev tools. See documentation: http://bit.ly/object-formatters
// Note that the "Enable custom formatters" setting must be turned on in order to use these formatters.

import { isTime } from "@foxglove/rostime";

import { hashString } from "@lichtblick/suite-base/util/hashString";
import { mightActuallyBePartial } from "@lichtblick/suite-base/util/mightActuallyBePartial";

type HtmlTemplate = unknown;
type DevtoolFormatterConfig = {
  key: unknown;
};

interface DevtoolFormatter {
  header: (object: Record<string, unknown>, config: DevtoolFormatterConfig) => HtmlTemplate;
  hasBody: (object: unknown) => boolean;
  body?: (object: Record<string, unknown>) => HtmlTemplate;
}

declare global {
  interface Window {
    devtoolsFormatters: DevtoolFormatter[];
  }
}

const USE_DEFAULT_FORMATTER = null;

const timeFormatter: DevtoolFormatter = (() => {
  function groupDigits(str: string) {
    const result = ["span", {}];
    let start = 0;
    let end = str.length % 3;
    if (end === 0) {
      end = 3;
    }
    while (start < str.length) {
      result.push([
        "span",
        { style: end < str.length ? "margin-right: 2px;" : "" },
        str.substring(start, end),
      ]);
      start = end;
      end += 3;
    }
    return result;
  }

  const formatter: DevtoolFormatter = {
    header(obj) {
      const maybeTime = obj as {
        sec: number;
        nsec: number;
      };
      if (
        !isTime(obj) ||
        maybeTime.sec < 0 ||
        maybeTime.nsec < 0 ||
        maybeTime.nsec >= 1e9 ||
        !Number.isInteger(maybeTime.sec) ||
        !Number.isInteger(maybeTime.nsec)
      ) {
        return USE_DEFAULT_FORMATTER;
      }
      const nsec = maybeTime.nsec.toFixed().padStart(9, "0");
      // Stable per-time color from independent bits of the hash
      const hash = hashString(`${maybeTime.sec}.${nsec}`);
      const hue = hash % 360;
      const saturation = 40 + ((hash >>> 9) % 60);
      const lightness = 20 + ((hash >>> 16) % 40);
      return [
        "span",
        { style: `color: hsl(${hue}deg, ${saturation}%, ${lightness}%);` },
        groupDigits(String(maybeTime.sec)),
        ".",
        groupDigits(nsec),
      ];
    },
    hasBody() {
      return false;
    },
  };

  return formatter;
})();

export default function installDevtoolsFormatters(): void {
  window.devtoolsFormatters = mightActuallyBePartial(window).devtoolsFormatters ?? [];
  window.devtoolsFormatters.push(timeFormatter);
}
