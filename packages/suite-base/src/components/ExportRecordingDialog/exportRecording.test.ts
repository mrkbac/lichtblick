// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  exportFileName,
  findDuplicateOutputTopics,
  toExportTopics,
  remoteFileName,
  topicFilterPattern,
} from "./exportRecording";

describe("exportRecording", () => {
  it("keeps only selected topics and treats a blank rename as no rename", () => {
    const topics = toExportTopics(
      new Map([
        ["/a", { keep: true, rename: " ", everyNth: 1 }],
        ["/b", { keep: false, rename: "/x", everyNth: 1 }],
        ["/c", { keep: true, rename: "/new", everyNth: 3 }],
      ]),
    );
    expect([...topics]).toEqual([
      ["/a", { outputTopic: undefined, everyNth: 1 }],
      ["/c", { outputTopic: "/new", everyNth: 3 }],
    ]);
  });

  it("finds output topic collisions, including a rename onto a kept topic", () => {
    expect(
      findDuplicateOutputTopics(
        new Map([
          ["/a", {}],
          ["/b", { outputTopic: "/a" }],
          ["/c", { outputTopic: "/d" }],
        ]),
      ),
    ).toEqual(new Set(["/a"]));
  });

  it("suggests an output file name", () => {
    expect(exportFileName("example.MCAP")).toBe("example-export.mcap");
  });
});

describe("topicFilterPattern", () => {
  it("matches topics by case-insensitive regex", () => {
    const pattern = topicFilterPattern("^/camera/.*/compressed$");
    expect(pattern.test("/camera/Front/compressed")).toBe(true);
    expect(pattern.test("/lidar/points")).toBe(false);
    expect(topicFilterPattern("IMU").test("/sensors/imu")).toBe(true);
  });

  it("matches invalid regex text literally", () => {
    const pattern = topicFilterPattern("/a(");
    expect(pattern.test("/a(b")).toBe(true);
    expect(pattern.test("/ab")).toBe(false);
  });
});

describe("remoteFileName", () => {
  it("decodes the last path segment, keeping malformed escapes as they are", () => {
    expect(remoteFileName("https://example.com/data/run%201.mcap?sig=x")).toBe("run 1.mcap");
    expect(remoteFileName("https://example.com/data/100%25%zz.mcap")).toBe("100%25%zz.mcap");
  });
});
