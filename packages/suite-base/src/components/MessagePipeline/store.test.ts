/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Mock } from "vitest";

import FakePlayer from "@lichtblick/suite-base/components/MessagePipeline/FakePlayer";
import { localResourceFolders } from "@lichtblick/suite-base/util/localResourceFolders";

import { createMessagePipelineStore } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createMessagePipelineStore", () => {
  it("should return undefined when the player does not support backfill lookups", async () => {
    // GIVEN - a store backed by a player that cannot answer backfill lookups
    const store = createMessagePipelineStore({
      promisesToWaitForRef: { current: [] },
      initialPlayer: new FakePlayer(),
    });

    // WHEN - requesting a point-in-time message
    const result = await store.getState().public.getMessageAtTime("/topic", {
      sec: 1,
      nsec: 0,
    });

    // THEN - the store reports that the lookup is unsupported
    expect(result).toBeUndefined();
  });

  it("should return the matching backfill message when the player can resolve messages", async () => {
    // GIVEN - a player that can return multiple backfill messages
    const player = new FakePlayer() as FakePlayer & {
      getBackfillMessages: Mock;
    };
    const matchingMessage = {
      topic: "/topic",
      receiveTime: { sec: 1, nsec: 0 },
      message: { value: 2 },
      schemaName: "schema",
      sizeInBytes: 0,
    };
    const otherMessage = {
      topic: "/other",
      receiveTime: { sec: 1, nsec: 0 },
      message: { value: 1 },
      schemaName: "schema",
      sizeInBytes: 0,
    };
    player.getBackfillMessages = vi.fn().mockResolvedValue([otherMessage, matchingMessage]);
    const store = createMessagePipelineStore({
      promisesToWaitForRef: { current: [] },
      initialPlayer: player,
    });

    // WHEN - requesting the message at a specific time for one topic
    const result = await store.getState().public.getMessageAtTime("/topic", {
      sec: 1,
      nsec: 0,
    });

    // THEN - the store asks for that topic and returns the matching message
    expect(player.getBackfillMessages).toHaveBeenCalledWith({
      topics: new Map([["/topic", { topic: "/topic" }]]),
      time: {
        sec: 1,
        nsec: 0,
      },
    });
    expect(result).toEqual(matchingMessage);
  });
});

it("loads granted workspace resources through the shared pipeline", async () => {
  const asset = { uri: "local-asset://root/mesh.stl", data: new Uint8Array([1]) };
  const fetch = vi.spyOn(localResourceFolders, "fetchAsset").mockResolvedValue(asset);
  const store = createMessagePipelineStore({
    promisesToWaitForRef: { current: [] },
    initialPlayer: undefined,
  });
  expect(await store.getState().public.fetchAsset("package://robot/mesh.stl")).toBe(asset);
  expect(fetch).toHaveBeenCalledWith("package://robot/mesh.stl", undefined);
});

it("preserves remote package lookup when no granted package matches", async () => {
  const asset = { uri: "package://remote/mesh.stl", data: new Uint8Array([2]) };
  const local = vi.spyOn(localResourceFolders, "fetchAsset").mockResolvedValue(undefined);
  const remote = vi.fn().mockResolvedValue(asset);
  const player = Object.assign(new FakePlayer(), { fetchAsset: remote });
  const store = createMessagePipelineStore({
    promisesToWaitForRef: { current: [] },
    initialPlayer: player,
  });
  expect(await store.getState().public.fetchAsset(asset.uri)).toBe(asset);
  expect(remote).toHaveBeenCalledWith(asset.uri);
  expect(local).toHaveBeenCalledWith(asset.uri, undefined);
});

it("keeps desktop package lookup independent of browser grants", async () => {
  vi.stubGlobal("desktopBridge", {});
  const asset = { uri: "package://robot/mesh.stl", data: new Uint8Array([3]) };
  const local = vi.spyOn(localResourceFolders, "fetchAsset");
  const player = Object.assign(new FakePlayer(), { fetchAsset: vi.fn().mockResolvedValue(asset) });
  const store = createMessagePipelineStore({
    promisesToWaitForRef: { current: [] },
    initialPlayer: player,
  });
  expect(await store.getState().public.fetchAsset(asset.uri)).toBe(asset);
  expect(local).not.toHaveBeenCalled();
});

it("explains how to grant access to a missing ROS package", async () => {
  const store = createMessagePipelineStore({
    promisesToWaitForRef: { current: [] },
    initialPlayer: undefined,
  });
  await expect(store.getState().public.fetchAsset("package://missing/mesh.stl")).rejects.toThrow(
    'ROS package "missing" was not found. Select its resource folder in Settings.',
  );
});
