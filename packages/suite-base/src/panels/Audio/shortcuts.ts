// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by the panel's message path drop config. */
export const AUDIO_SHORTCUTS = [
  { id: "audio.dropTopic", titleKey: "audioDropTopic", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
