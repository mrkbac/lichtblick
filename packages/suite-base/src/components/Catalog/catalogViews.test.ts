// SPDX-License-Identifier: MPL-2.0

import { timelineBar, timelineRange } from "./catalogViews";
import { CatalogRecording } from "./types";

const recording: CatalogRecording = {
  id: "test",
  name: "Test",
  source: { type: "local-file", path: "test.mcap" },
  start: { sec: 0, nsec: 10 },
  end: { sec: 0, nsec: 20 },
};

it("keeps relative and wall-clock recordings on different scales and preserves subsecond spans", () => {
  const instant = { sec: 1_784_000_000, nsec: 250 };
  const wallClock = { ...recording, start: instant, end: instant };
  const span = { ...recording, start: { sec: 0, nsec: 0 }, end: { sec: 0, nsec: 40 } };
  const recordings = [wallClock, recording, span];
  const range = timelineRange(recordings, "relative");
  expect(timelineBar(recording, range)).toEqual({ left: "25%", width: "25%" });
  expect(timelineBar(wallClock, range)).toBeUndefined();
  expect(timelineBar(wallClock, timelineRange(recordings, "wall"))).toEqual({
    left: "0%",
    width: "0%",
  });
});
