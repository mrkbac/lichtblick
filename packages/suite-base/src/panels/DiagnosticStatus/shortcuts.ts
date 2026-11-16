// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  DIAGNOSTICS_DROP_TOPIC_SHORTCUT,
  DIAGNOSTICS_SEEK_SHORTCUT,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/shortcuts";
import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by DiagnosticTable. */
export const DIAGNOSTIC_STATUS_SHORTCUTS = [
  {
    id: "diagnosticStatus.previousValue",
    titleKey: "diagnosticStatusPreviousValue",
    keys: [],
    mouse: [{ action: "hover" }],
  },
  {
    id: "diagnosticStatus.resizeColumns",
    titleKey: "diagnosticStatusResizeColumns",
    keys: [],
    mouse: [{ action: "drag" }],
  },
  DIAGNOSTICS_SEEK_SHORTCUT,
  DIAGNOSTICS_DROP_TOPIC_SHORTCUT,
] as const satisfies readonly KeyboardShortcut[];
