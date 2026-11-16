// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by the topic name button in each row. */
export const TOPIC_HEALTH_SHORTCUTS = [
  {
    id: "topicHealth.openTopic",
    titleKey: "topicHealthOpenTopic",
    keys: [],
    mouse: [{ action: "click" }],
  },
] as const satisfies readonly KeyboardShortcut[];
