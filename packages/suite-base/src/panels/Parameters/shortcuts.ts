// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Keys are bound from these declarations by the filter, the namespace rows and the value editor. */
export const PARAMETERS_SHORTCUT = {
  clearFilter: {
    id: "parameters.clearFilter",
    titleKey: "parametersClearFilter",
    keys: [{ key: "Escape" }],
  },
  toggleNamespace: {
    id: "parameters.toggleNamespace",
    titleKey: "parametersToggleNamespace",
    keys: [{ key: "Enter" }, { key: " " }],
    mouse: [{ action: "click" }],
  },
  submitValue: {
    id: "parameters.submitValue",
    titleKey: "parametersSubmitValue",
    keys: [{ key: "Enter", shift: false }],
  },
  resetValue: {
    id: "parameters.resetValue",
    titleKey: "parametersResetValue",
    keys: [{ key: "Escape" }],
  },
} as const satisfies Record<string, KeyboardShortcut>;

export const PARAMETERS_SHORTCUTS: readonly KeyboardShortcut[] = Object.values(PARAMETERS_SHORTCUT);
