// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";
import { MessagePipelineContext } from "@lichtblick/suite-base/components/MessagePipeline/types";
import {
  PlayerPresence,
  PlayerState,
  SubscribePayload,
} from "@lichtblick/suite-base/players/types";

import { SideView } from "./sideView";

function event(topic: string, sec = 1): MessageEvent {
  return {
    topic,
    schemaName: "S",
    receiveTime: { sec, nsec: 0 },
    message: { sec },
    sizeInBytes: 1,
  };
}

const TOPICS = ["/a/odom", "/b/odom", "/b/only_b", "/script_out"];

function context(overrides: Partial<MessagePipelineContext> = {}): MessagePipelineContext {
  const playerState: PlayerState = {
    presence: PlayerPresence.PRESENT,
    progress: {
      messageCache: {
        startTime: { sec: 0, nsec: 0 },
        blocks: [
          {
            messagesByTopic: { "/a/odom": [event("/a/odom")], "/b/odom": [event("/b/odom")] },
            sizeInBytes: 2,
          },
          undefined,
        ],
      },
    },
    capabilities: [],
    profile: undefined,
    playerId: "p",
    activeData: {
      messages: [event("/a/odom"), event("/b/odom"), event("/script_out")],
      totalBytesReceived: 0,
      currentTime: { sec: 1, nsec: 0 },
      startTime: { sec: 0, nsec: 0 },
      endTime: { sec: 2, nsec: 0 },
      isPlaying: false,
      speed: 1,
      lastSeekTime: 0,
      topics: TOPICS.map((name) => ({ name, schemaName: "S" })),
      topicStats: new Map(TOPICS.map((name) => [name, { numMessages: 1 }])),
      datatypes: new Map(),
    },
  };
  return {
    playerState,
    sortedTopics: TOPICS.map((name) => ({ name, schemaName: "S" })),
    sortedServices: [],
    datatypes: new Map(),
    subscriptions: [],
    messageEventsBySubscriberId: new Map([
      ["panel@compare/b", [event("/b/odom")]],
      ["panel@compare/a", [event("/a/odom")]],
      ["other", [event("/a/odom")]],
    ]),
    setSubscriptions: vi.fn(),
    setPublishers: vi.fn(),
    setParameter: vi.fn(),
    publish: vi.fn(),
    getMetadata: vi.fn(),
    callService: vi.fn(),
    fetchAsset: vi.fn(),
    pauseFrame: vi.fn(),
    getBatchIterator: vi.fn(),
    getMessageAtTime: vi.fn(),
    ...overrides,
  };
}

describe("SideView", () => {
  const view = new SideView("/b", ["/a", "/b"]);

  it("shows its own topics without the prefix, topics of no side as they are, others not at all", () => {
    const mapped = view.mapPublic(context());
    expect(mapped.sortedTopics.map((topic) => topic.name)).toEqual([
      "/odom",
      "/only_b",
      "/script_out",
    ]);
    expect(mapped.playerState.activeData?.topics.map((topic) => topic.name)).toEqual([
      "/odom",
      "/only_b",
      "/script_out",
    ]);
    expect([...mapped.playerState.activeData!.topicStats.keys()]).toEqual([
      "/odom",
      "/only_b",
      "/script_out",
    ]);
  });

  it("renames messages, blocks and per-subscriber messages of its side", () => {
    const mapped = view.mapPublic(context());
    expect(mapped.playerState.activeData?.messages.map((message) => message.topic)).toEqual([
      "/odom",
      "/script_out",
    ]);
    expect(
      Object.keys(mapped.playerState.progress.messageCache!.blocks[0]!.messagesByTopic),
    ).toEqual(["/odom"]);
    expect(mapped.playerState.progress.messageCache!.blocks[1]).toBeUndefined();
    expect([...mapped.messageEventsBySubscriberId.keys()]).toEqual(["panel"]);
    expect(mapped.messageEventsBySubscriberId.get("panel")?.[0]?.topic).toEqual("/odom");
  });

  it("subscribes to its side's topics under its own subscriber id", () => {
    const setSubscriptions = vi.fn();
    const mapped = view.mapPublic(context({ setSubscriptions }));
    const payloads: SubscribePayload[] = [
      { topic: "/odom" },
      { topic: "/script_out" },
      { topic: "/a/odom" },
      { topic: "/not_yet_known" },
    ];
    mapped.setSubscriptions("panel", payloads);
    expect(setSubscriptions).toHaveBeenCalledWith("panel@compare/b", [
      { topic: "/b/odom" },
      // Outside every side: kept
      { topic: "/script_out" },
      // Already names a side: kept
      { topic: "/a/odom" },
      // Unknown topics are read from this side
      { topic: "/b/not_yet_known" },
    ]);
  });

  it("returns the same objects for the same input, so selectors stay stable", () => {
    const base = context();
    const first = view.mapPublic(base);
    expect(view.mapPublic(base)).toBe(first);
    const next = view.mapPublic({ ...base, subscriptions: [] });
    expect(next.sortedTopics).toBe(first.sortedTopics);
    expect(next.setSubscriptions).toBe(first.setSubscriptions);
    expect(next.playerState).toBe(first.playerState);
  });

  it("reads messages of its side at a time", async () => {
    const getMessageAtTime = vi.fn(async (topic: string) => event(topic));
    const mapped = view.mapPublic(context({ getMessageAtTime }));
    const message = await mapped.getMessageAtTime("/odom", { sec: 1, nsec: 0 });
    expect(getMessageAtTime).toHaveBeenCalledWith("/b/odom", { sec: 1, nsec: 0 }, undefined);
    expect(message?.topic).toEqual("/odom");
  });
});
