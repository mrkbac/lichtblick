// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro:
    "See where playback time and memory go: data loading per topic, memory, main-thread load and the data pipeline, with sparklines over the last ten seconds.",
  sections: [
    {
      title: "Data loading",
      items: [
        [
          "Subscribed topics",
          "Topics any panel subscribes to; preloaded topics load the whole recording.",
        ],
        ["Recording loaded", "Share of the recording already loaded into memory."],
        [
          "Messages at playhead",
          "Size of messages delivered per topic around the playhead, now (last second) and max.",
        ],
      ],
    },
    {
      title: "Memory",
      items: [
        ["JS heap", "Used, allocated and limit of the page's JavaScript heap (Chromium only)."],
        [
          "Page and workers",
          "Memory of the page plus its workers (Chromium, cross-origin isolated only; updated every 10 s).",
        ],
        ["Player memory", "Caches the data source holds, e.g. preloaded or buffered messages."],
      ],
    },
    {
      title: "Main thread",
      items: [
        [
          "Display frame rate",
          "Frames the browser paints per second; matches your display's refresh rate when idle.",
        ],
        [
          "Event loop latency",
          "How late a timer fires; high values mean the main thread is blocked and the UI stutters.",
        ],
      ],
    },
    {
      title: "Data pipeline",
      items: [
        [
          "Playback speed",
          "Speed actually reached relative to recording time, next to the selected speed.",
        ],
        ["Player updates", "How often the player pushes new data to panels."],
        ["Recording time per update", "Recording time covered by each player update."],
        ["Messages delivered", "Messages per second handed to panels."],
        ["Source throughput", "Bytes read from the data source (file, network or server)."],
      ],
    },
  ],
};

export default docs;
