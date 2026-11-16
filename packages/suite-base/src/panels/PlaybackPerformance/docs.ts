// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Show how fast playback runs, with sparklines over the last five seconds.",
  sections: [
    {
      title: "Metrics",
      items: [
        ["× realtime", "Playback speed actually reached, relative to recording time."],
        ["fps", "Frames rendered per second while playing."],
        ["ms bag frame", "Recording time covered by each rendered frame."],
        ["Mbps", "Data received from the source."],
      ],
    },
  ],
};

export default docs;
