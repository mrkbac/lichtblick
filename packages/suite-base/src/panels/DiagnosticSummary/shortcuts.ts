// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Shared by both diagnostics panels. Display only: handled by DiagnosticTimeline. */
export const DIAGNOSTICS_SEEK_SHORTCUT = {
  id: "diagnostics.seekTimeline",
  titleKey: "diagnosticsSeekTimeline",
  keys: [],
  mouse: [{ action: "click" }],
} as const satisfies KeyboardShortcut;

/** Shared by both diagnostics panels. Display only: handled by useDiagnosticTopicsDrop. */
export const DIAGNOSTICS_DROP_TOPIC_SHORTCUT = {
  id: "diagnostics.dropTopic",
  titleKey: "diagnosticsDropTopic",
  keys: [],
  mouse: [{ action: "drop" }],
} as const satisfies KeyboardShortcut;

/** Display only: handled by DiagnosticNodeRow. */
export const DIAGNOSTIC_SUMMARY_SHORTCUTS = [
  {
    id: "diagnosticSummary.openDetail",
    titleKey: "diagnosticSummaryOpenDetail",
    keys: [],
    mouse: [{ action: "click" }],
  },
  DIAGNOSTICS_SEEK_SHORTCUT,
  DIAGNOSTICS_DROP_TOPIC_SHORTCUT,
] as const satisfies readonly KeyboardShortcut[];
