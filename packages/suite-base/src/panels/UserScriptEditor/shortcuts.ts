// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Rename keys are bound from here by ScriptListItem. Save is display only: a Monaco action in Editor. */
export const USER_SCRIPTS_SHORTCUTS = [
  { id: "userScripts.save", titleKey: "userScriptsSave", keys: [{ key: "s", mod: true }] },
  {
    id: "userScripts.rename",
    titleKey: "userScriptsRename",
    keys: [{ key: "Enter" }],
    mouse: [{ action: "double-click" }],
  },
  {
    id: "userScripts.cancelRename",
    titleKey: "userScriptsCancelRename",
    keys: [{ key: "Escape" }],
  },
] as const satisfies readonly KeyboardShortcut[];
