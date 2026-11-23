// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback } from "react";

import { Time } from "@lichtblick/suite";
import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { TimeDisplayMethod } from "@lichtblick/suite-base/types/panels";
import { formatDate, formatTime } from "@lichtblick/suite-base/util/formatTime";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";

import { useAppConfigurationValue } from "./useAppConfigurationValue";

export interface IAppTimeFormat {
  formatDate: (date: Time) => string;
  formatTime: (stamp: Time) => string;
  timeFormat: TimeDisplayMethod;
  setTimeFormat: (format: TimeDisplayMethod) => Promise<void>;
  timeZone: string | undefined;
}

export function useAppTimeFormat(): IAppTimeFormat {
  const [timeFormat, setTimeFormat] = useAppConfigurationValue<string>(AppSetting.TIME_FORMAT);
  const [timeZone] = useAppConfigurationValue<string>(AppSetting.TIMEZONE);

  const effectiveFormat: TimeDisplayMethod = timeFormat === "SEC" ? "SEC" : "TOD";

  const formatDateCallback = useCallback(
    (date: Time) => {
      return formatDate(date, timeZone);
    },
    [timeZone],
  );

  const formatTimeCallback = useCallback(
    (stamp: Time) => {
      if (effectiveFormat === "TOD") {
        return formatTime(stamp, timeZone);
      } else {
        return formatTimeRaw(stamp);
      }
    },
    [effectiveFormat, timeZone],
  );

  return {
    formatDate: formatDateCallback,
    formatTime: formatTimeCallback,
    setTimeFormat,
    timeFormat: effectiveFormat,
    timeZone,
  };
}
