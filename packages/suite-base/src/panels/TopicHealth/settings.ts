// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { TopicHealthConfig } from "./health";

/** Only topics with overrides get a node; the table edits expectations inline. */
export function buildSettingsTree(config: TopicHealthConfig): DocumentedNodes {
  return {
    general: {
      label: "General",
      fields: {
        tolerancePercent: {
          label: "Slow below expected by (%)",
          help: "How far below the expected rate a topic may fall before it counts as slow.",
          input: "number",
          min: 0,
          max: 100,
          step: 5,
          value: config.tolerancePercent,
        },
        sortByStatus: {
          label: "Problems first",
          help: "Sorts slow and stale topics to the top instead of alphabetically.",
          input: "boolean",
          value: config.sortByStatus ?? false,
        },
      },
    },
    topics: {
      label: "Topic overrides",
      help: "Topics whose expected rate, stale time or detailed statistics you changed.",
      children: Object.fromEntries(
        Object.keys(config.topics)
          .sort()
          .map((topic) => {
            const settings = config.topics[topic]!;
            return [
              topic,
              {
                label: topic,
                actions: [{ type: "action", id: "remove", label: "Reset to automatic" }],
                fields: {
                  expectedHz: {
                    label: "Expected rate (Hz)",
                    help: "Leave empty to learn the rate; 0 disables monitoring.",
                    input: "number",
                    min: 0,
                    value: settings.expectedHz,
                  },
                  staleAfterSec: {
                    label: "Stale after (s)",
                    help: "Leave empty for five expected periods.",
                    input: "number",
                    min: 0,
                    value: settings.staleAfterSec,
                  },
                  deepStats: {
                    label: "Detailed statistics",
                    help: "Scans the recording, or subscribes on live sources, for jitter, max gap and bandwidth.",
                    input: "boolean",
                    value: settings.deepStats ?? false,
                  },
                },
              },
            ];
          }),
      ),
    },
  };
}
