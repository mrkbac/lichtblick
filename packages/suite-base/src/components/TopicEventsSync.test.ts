// SPDX-License-Identifier: MPL-2.0

import { positionEvents, toDataSourceEvent } from "./TopicEventsSync";

describe("toDataSourceEvent", () => {
  it("converts a foxglove.Event message", () => {
    const event = toDataSourceEvent(
      {
        start_time: { sec: 10, nsec: 0 },
        end_time: { sec: 12, nsec: 500_000_000 },
        metadata: [{ key: "kind", value: "stop" }, undefined, { key: "note" }],
      },
      "/events#0",
      "/events",
    );
    expect(event).toMatchObject({
      id: "/events#0",
      startTime: { sec: 10, nsec: 0 },
      endTime: { sec: 12, nsec: 500_000_000 },
      durationNanos: "2500000000",
      metadata: { topic: "/events", kind: "stop", note: "" },
    });
  });

  it("treats a missing end time as an instant and skips events without a start", () => {
    expect(toDataSourceEvent({ start_time: { sec: 1, nsec: 0 } }, "a", "/e")?.durationNanos).toBe(
      "0",
    );
    expect(toDataSourceEvent({}, "b", "/e")).toBeUndefined();
  });
});

describe("positionEvents", () => {
  it("sorts events and places them relative to the timeline", () => {
    const at = (sec: number, id: string) =>
      toDataSourceEvent(
        { start_time: { sec, nsec: 0 }, end_time: { sec: sec + 1, nsec: 0 } },
        id,
        "/e",
      )!;
    const positioned = positionEvents(
      [at(15, "late"), at(10, "early")],
      { sec: 10, nsec: 0 },
      { sec: 20, nsec: 0 },
    );
    expect(
      positioned.map((p) => [p.event.id, p.startPosition, p.endPosition, p.secondsSinceStart]),
    ).toEqual([
      ["early", 0, 0.1, 0],
      ["late", 0.5, 0.6, 5],
    ]);
  });
});
