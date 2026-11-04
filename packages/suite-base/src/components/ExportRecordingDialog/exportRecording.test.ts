// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { exportFileName, findDuplicateOutputTopics, toExportTopics } from "./exportRecording";

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
