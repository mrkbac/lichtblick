// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { namespaceTotals, topicTreeRows } from "./topicTree";

it("groups nested namespaces and collapses only their descendants", () => {
  const topics = [
    { name: "/camera/front", schemaName: "Image" },
    { name: "/camera/rear", schemaName: "Image" },
    { name: "/imu", schemaName: "Imu" },
  ];
  expect(topicTreeRows(topics, new Set())).toEqual([
    { kind: "namespace", path: "/camera", depth: 0, count: 2, topics: topics.slice(0, 2) },
    { kind: "topic", topic: topics[0], depth: 1 },
    { kind: "topic", topic: topics[1], depth: 1 },
    { kind: "topic", topic: topics[2], depth: 0 },
  ]);
  expect(topicTreeRows(topics, new Set(["/camera"]))).toEqual([
    { kind: "namespace", path: "/camera", depth: 0, count: 2, topics: topics.slice(0, 2) },
    { kind: "topic", topic: topics[2], depth: 0 },
  ]);
});

it("retains topics that are namespace prefixes and non-ROS names", () => {
  const topics = [
    { name: "/a", schemaName: undefined },
    { name: "/a/b", schemaName: undefined },
    { name: "events", schemaName: undefined },
  ];
  const rows = topicTreeRows(topics, new Set());
  expect(rows.filter((row) => row.kind === "topic").map((row) => row.topic.name)).toEqual([
    "/a",
    "/a/b",
    "events",
  ]);
});

it("does not merge distinct arbitrary MCAP topic names with repeated slashes", () => {
  const topics = ["/camera//front", "/camera/front", "//camera", "/"].map((name) => ({
    name,
    schemaName: undefined,
  }));
  const actual = topicTreeRows(topics, new Set()).flatMap((row) =>
    row.kind === "topic" ? [row.topic.name] : [],
  );
  expect(actual.sort()).toEqual(topics.map((topic) => topic.name).sort());
});

it("totals namespace descendants and distinguishes partial scans from complete payload totals", () => {
  const topics = ["/a", "/a/b", "/a/c"].map((name) => ({ name, schemaName: undefined }));
  const data = { count: 2, bytes: 12, estimatedBytes: false, buckets: [2] };
  const partial = namespaceTotals(topics, new Map([["/a", data]]), () => 2);
  expect(partial).toMatchObject({ count: 6, bytes: 12, scanned: 1, complete: false });
  const full = namespaceTotals(topics, new Map(topics.map((topic) => [topic.name, data])), () => 2);
  expect(full).toMatchObject({ count: 6, bytes: 36, scanned: 3, complete: true });
  expect(full.buckets[0]).toBe(6);
  expect(namespaceTotals(topics, new Map(), () => undefined).count).toBeUndefined();
});
