// SPDX-License-Identifier: MPL-2.0

import { parseCatalog } from "./catalogUrl";

const CATALOG_URL = "https://example.com/samples/catalog.json";

describe("parseCatalog", () => {
  it("resolves relative URLs against the catalog and keeps nanosecond times", () => {
    const catalog = parseCatalog(
      {
        version: 1,
        name: "Samples",
        recordings: [
          {
            id: "a",
            source: { type: "remote-file", url: "data/run%201.mcap" },
            start: "2026-10-01T10:00:00.587056791Z",
            end: "2026-10-01T10:01:00Z",
            size: 10,
            topics: [{ name: "/camera", schema: "foxglove.CompressedVideo", messages: 3 }],
            thumbnail: "a.jpg",
            layout: "/layouts/a.json",
            description: "CC BY 4.0",
            dataset: "Outdoor",
            device: "Unit 1",
            session: "Run 1",
            episode: "Approach",
            events: [
              { name: "Stop", start: "2026-10-01T10:00:00.587056791Z" },
              { name: "Invalid", start: 1 },
            ],
          },
          {
            id: "b",
            name: "Live",
            source: { type: "foxglove-websocket", url: "ws://localhost:8765" },
          },
        ],
      },
      CATALOG_URL,
    );

    expect(catalog.name).toBe("Samples");
    expect(catalog.recordings[0]).toMatchObject({
      id: "a",
      name: "run 1.mcap",
      source: { type: "remote-file", url: "https://example.com/samples/data/run%201.mcap" },
      start: { sec: 1790848800, nsec: 587056791 },
      end: { sec: 1790848860, nsec: 0 },
      size: 10,
      topics: [{ name: "/camera", schema: "foxglove.CompressedVideo", messages: 3 }],
      thumbnail: "https://example.com/samples/a.jpg",
      layoutUrl: "https://example.com/layouts/a.json",
      description: "CC BY 4.0",
      dataset: "Outdoor",
      machine: "Unit 1",
      session: "Run 1",
      episode: "Approach",
      events: [{ name: "Stop", start: { sec: 1790848800, nsec: 587056791 } }],
    });
    expect(catalog.recordings[1]).toMatchObject({
      name: "Live",
      source: { type: "foxglove-websocket", url: "ws://localhost:8765/" },
    });
  });

  it("keeps an undecodable file name as it is", () => {
    const catalog = parseCatalog(
      {
        version: 1,
        recordings: [{ id: "a", source: { type: "remote-file", url: "run%FF.mcap" } }],
      },
      CATALOG_URL,
    );
    expect(catalog.recordings[0]?.name).toBe("run%FF.mcap");
  });

  it.each([
    [{ version: 2, recordings: [] }, /version 1/],
    [{ version: 1 }, /version 1/],
    [{ version: 1, recordings: [{ source: { type: "remote-file", url: "a" } }] }, /unique id/],
    [
      {
        version: 1,
        recordings: [
          { id: "a", source: { type: "remote-file", url: "a" } },
          { id: "a", source: { type: "remote-file", url: "b" } },
        ],
      },
      /unique id/,
    ],
    [
      { version: 1, recordings: [{ id: "a", source: { type: "local-file", path: "a" } }] },
      /source/,
    ],
    [
      {
        version: 1,
        recordings: [{ id: "a", source: { type: "remote-file", url: "http://[bad" } }],
      },
      /Invalid URL/,
    ],
  ])("rejects %j", (json, error) => {
    expect(() => parseCatalog(json, CATALOG_URL)).toThrow(error);
  });

  it("reads map tracks and preview clips, dropping invalid entries", () => {
    const [recording] = parseCatalog(
      {
        version: 1,
        recordings: [
          {
            id: "a",
            source: { type: "remote-file", url: "a.mcap" },
            tracks: [
              { topic: "/gps", points: [[11.5, 48.1], [200, 0], "bad", [11.6, 48.2]] },
              { topic: "/empty", points: [] },
              { points: [[1, 2]] },
            ],
            previews: [
              {
                topic: "/camera/front",
                frames: [
                  { offset: 0, url: "previews/a/0.jpg" },
                  { offset: 2 },
                  { offset: 4, url: "previews/a/1.jpg" },
                ],
              },
              { topic: "/camera/rear", frames: [{ offset: 0, url: "previews/a/rear.jpg" }] },
              { topic: "/camera/none", frames: [] },
            ],
          },
        ],
      },
      CATALOG_URL,
    ).recordings;

    expect(recording!.tracks).toEqual([
      {
        topic: "/gps",
        points: [
          [11.5, 48.1],
          [11.6, 48.2],
        ],
      },
    ]);
    expect(recording!.previewTopics).toEqual(["/camera/front", "/camera/rear"]);
    expect(recording!.previews?.["/camera/front"]).toEqual([
      { offsetSec: 0, url: "https://example.com/samples/previews/a/0.jpg" },
      { offsetSec: 4, url: "https://example.com/samples/previews/a/1.jpg" },
    ]);
    // No thumbnail given: the first clip's first frame stands in
    expect(recording!.thumbnail).toBe("https://example.com/samples/previews/a/0.jpg");
  });
});
