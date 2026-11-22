// SPDX-License-Identifier: MPL-2.0

import { Topic } from "@lichtblick/suite";
import { Annotation } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/annotations/types";

import {
  annotationTopicNames,
  AnnotationEntry,
  makeAnnotationEntry,
  MAX_ANNOTATION_HISTORY,
  matchAnnotationTopics,
  pickAnnotations,
  pruneAnnotationHistory,
  tileAnnotationTopics,
} from "./annotations";

const circle = (sec: number): Annotation => ({
  type: "circle",
  stamp: { sec, nsec: 0 },
  radius: 1,
  thickness: 1,
  position: { x: 0, y: 0 },
  messagePath: [],
});

describe("annotation topics", () => {
  it("lists topics with a supported annotation schema", () => {
    const topics: Topic[] = [
      { name: "/b/markers", schemaName: "visualization_msgs/ImageMarker" },
      { name: "/a/annotations", schemaName: "foxglove.ImageAnnotations" },
      { name: "/a/image", schemaName: "sensor_msgs/Image" },
    ];
    expect(annotationTopicNames(topics)).toEqual(["/a/annotations", "/b/markers"]);
  });

  it("matches annotation topics in the image topic's namespace", () => {
    const available = ["/cam1/annotations", "/cam1/detections/boxes", "/cam2/annotations", "/x"];
    expect(matchAnnotationTopics("/cam1/image", available)).toEqual([
      "/cam1/annotations",
      "/cam1/detections/boxes",
    ]);
    // A top-level image topic has no namespace to match
    expect(matchAnnotationTopics("/image", available)).toEqual([]);
  });

  it("prefers the tile's own pick, even an empty one, over the automatic match", () => {
    const available = ["/cam1/annotations", "/cam2/annotations"];
    expect(tileAnnotationTopics({ topic: "/cam1/image" }, available)).toEqual([
      "/cam1/annotations",
    ]);
    expect(
      tileAnnotationTopics(
        { topic: "/cam1/image", annotationTopics: ["/cam2/annotations"] },
        available,
      ),
    ).toEqual(["/cam2/annotations"]);
    expect(tileAnnotationTopics({ topic: "/cam1/image", annotationTopics: [] }, available)).toEqual(
      [],
    );
  });
});

describe("pickAnnotations", () => {
  const history = [1, 2, 3].map((sec) => makeAnnotationEntry([circle(sec)]));

  it("takes the newest message unless syncing", () => {
    expect(pickAnnotations(history, 1_000_000_000n, { sync: false })).toBe(history[2]);
    expect(pickAnnotations(undefined, undefined, { sync: false })).toBeUndefined();
  });

  it("takes the message stamped like the image when syncing, or none", () => {
    expect(pickAnnotations(history, 2_000_000_000n, { sync: true })).toBe(history[1]);
    expect(pickAnnotations(history, 5_000_000_000n, { sync: true })).toBeUndefined();
  });

  it("stamps an empty message with nothing, so it never syncs", () => {
    expect(makeAnnotationEntry([]).stampNs).toBeUndefined();
  });
});

describe("pruneAnnotationHistory", () => {
  const S = 1_000_000_000n;
  const entries = (secs: number[]) => secs.map((sec) => makeAnnotationEntry([circle(sec)]));
  const secs = (history: AnnotationEntry[]) => history.map((entry) => Number(entry.stampNs! / S));

  it("keeps every message inside the window while images lag far behind", () => {
    // 30 annotation messages at 10 Hz ahead of an image still at the first one
    const history = Array.from({ length: 30 }, (_, i) =>
      makeAnnotationEntry([{ ...circle(0), stamp: { sec: 0, nsec: i * 100_000_000 } }]),
    );
    pruneAnnotationHistory(history);
    expect(history).toHaveLength(30);
    expect(pickAnnotations(history, 0n, { sync: true })).toBe(history[0]);
  });

  it("drops messages more than the window behind the newest", () => {
    const history = entries([0, 1, 5, 11]);
    pruneAnnotationHistory(history);
    expect(secs(history)).toEqual([1, 5, 11]);
  });

  it("keeps messages older than the shown image for a delayed image", () => {
    const history = entries([1, 2, 3]);
    // The tile shows the image at 3, then a delayed image stamped 1 arrives
    pruneAnnotationHistory(history);
    expect(pickAnnotations(history, 3n * S, { sync: true })).toBe(history[2]);
    expect(pickAnnotations(history, 1n * S, { sync: true })).toBe(history[0]);
  });

  it("drops unstamped messages unless newest, and caps streams whose stamps don't advance", () => {
    const history = [makeAnnotationEntry([]), ...entries([1]), makeAnnotationEntry([])];
    pruneAnnotationHistory(history);
    expect(history.map((entry) => entry.stampNs)).toEqual([S, undefined]);

    const stuck = entries(Array.from({ length: MAX_ANNOTATION_HISTORY + 5 }, () => 1));
    pruneAnnotationHistory(stuck);
    expect(stuck).toHaveLength(MAX_ANNOTATION_HISTORY);
  });
});
