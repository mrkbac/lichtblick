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
    });
    expect(catalog.recordings[1]).toMatchObject({
      name: "Live",
      source: { type: "foxglove-websocket", url: "ws://localhost:8765/" },
    });
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
  ])("rejects %j", (json, error) => {
    expect(() => parseCatalog(json, CATALOG_URL)).toThrow(error);
  });
});
