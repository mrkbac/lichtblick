// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by the topic table and ActivityChart. */
export const SOURCE_INFO_SHORTCUTS = [
  {
    id: "sourceInfo.toggleDetails",
    titleKey: "sourceInfoToggleDetails",
    keys: [],
    mouse: [{ action: "click" }],
  },
  {
    id: "sourceInfo.seekToActivity",
    titleKey: "sourceInfoSeekToActivity",
    keys: [],
    mouse: [{ action: "click" }],
  },
  {
    id: "sourceInfo.seekToInterval",
    titleKey: "sourceInfoSeekToInterval",
    keys: [],
    mouse: [{ action: "click" }],
  },
] as const satisfies readonly KeyboardShortcut[];
