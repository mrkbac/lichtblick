// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2020-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Time } from "@foxglove/rostime";

import RosbridgePlayer, {
  ROSBRIDGE_DEAD_LINK_MS,
} from "@lichtblick/suite-base/players/RosbridgePlayer";

const headerMessage = ({
  seq,
  stamp: { sec, nsec },
  frame_id,
}: {
  seq: number;
  stamp: Time;
  frame_id: string;
}) => {
  const bytes = Buffer.alloc(16 + frame_id.length);
  bytes.writeUInt32LE(seq, 0);
  bytes.writeUInt32LE(sec, 4);
  bytes.writeUInt32LE(nsec, 8);
  bytes.writeUInt32LE(frame_id.length, 12);
  bytes.write(frame_id, 16);
  return { bytes };
};

const textMessage = ({ text }: { text: string }) => {
  const bytes = Buffer.alloc(4 + text.length);
  bytes.writeUInt32LE(text.length, 0);
  bytes.write(text, 4);
  return { bytes };
};

const HEADER_TYPEDEF = `std_msgs/Header header

================================================================================
MSG: std_msgs/Header
uint32 seq
time stamp
string frame_id`;

let workerInstance: MockRosClient;
class MockRosClient {
  public constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    workerInstance = this;
  }

  #topics: string[] = [];
  #types: string[] = [];
  #typedefs_full_text: string[] = [];
  #connectCallback?: () => void;
  #messages: any[] = [];

  public setup({
    topics = [],
    types = [],
    typedefs = [],
    messages = [],
  }: {
    topics?: string[];
    types?: string[];
    typedefs?: string[];
    messages?: any[];
  }) {
    this.#topics = topics;
    this.#types = types;
    this.#typedefs_full_text = typedefs;
    this.#messages = messages;

    this.#connectCallback?.();
  }

  /** Changes what the server advertises, without reconnecting. */
  public advertise({
    topics,
    types,
    typedefs,
    messages,
  }: {
    topics: string[];
    types: string[];
    typedefs: string[];
    messages?: any[];
  }) {
    this.#topics = topics;
    this.#types = types;
    this.#typedefs_full_text = typedefs;
    this.#messages = messages ?? this.#messages;
  }

  public on(op: string, callback: () => void) {
    if (op === "connection") {
      this.#connectCallback = callback;
    } else if (op === "close") {
      this.emitClose = callback;
    }
  }

  /** Simulates the server dropping the connection. */
  public emitClose?: () => void;

  public closed = false;

  public close() {
    this.closed = true;
  }

  /** While set, topic requests wait until the test calls `settleTopics`. */
  public holdTopics = false;
  public settleTopics?: () => void;
  public topicRequests = 0;

  public getTopicsAndRawTypes(callback: (...args: unknown[]) => void) {
    this.topicRequests++;
    const reply = () => {
      callback({
        topics: this.#topics,
        types: this.#types,
        typedefs_full_text: this.#typedefs_full_text,
      });
    };
    if (this.holdTopics) {
      this.settleTopics = reply;
    } else {
      reply();
    }
  }

  public getMessagesByTopicName(topicName: string): { message: unknown }[] {
    return this.#messages.filter(({ topic }) => topic === topicName);
  }

  /** While set, node requests never answer, like a connection that drops mid-refresh. */
  public holdNodes = false;
  public nodeRequests = 0;

  /** Services of the one node the graph has, if set */
  public services: string[] = [];

  public getNodes(callback: (nodes: string[]) => void, _errCb: (error: Error) => void) {
    this.nodeRequests++;
    if (!this.holdNodes) {
      callback(this.services.length > 0 ? ["/node"] : []);
    }
  }

  public getNodeDetails(
    _node: string,
    callback: (subscriptions: string[], publications: string[], services: string[]) => void,
    _errCb: (error: Error) => void,
  ) {
    callback([], [], this.services);
  }

  /** Service type lookups that haven't answered yet */
  public pendingServiceTypes: (() => void)[] = [];

  public getServiceType(_service: string, callback: (type: string) => void) {
    this.pendingServiceTypes.push(() => {
      callback("pkg/Srv");
    });
  }

  public getServiceRequestDetails(_type: string, callback: (result: { typedefs: [] }) => void) {
    callback({ typedefs: [] });
  }

  public getServiceResponseDetails(_type: string, callback: (result: { typedefs: [] }) => void) {
    callback({ typedefs: [] });
  }
}

const subscribedTopics: string[] = [];
/** The latest subscriber of each topic, to deliver messages to */
const topicCallbacks = new Map<string, (arg: unknown) => void>();

class MockRosTopic {
  #name: string = "";

  public constructor({ name }: { name: string }) {
    this.#name = name;
  }

  public subscribe(callback: (arg: unknown) => void) {
    subscribedTopics.push(this.#name);
    topicCallbacks.set(this.#name, callback);
    workerInstance.getMessagesByTopicName(this.#name).forEach(({ message }) => {
      callback(message);
    });
  }

  public unsubscribe() {
    // no-op
  }
}

vi.mock("@foxglove/roslibjs", () => {
  return {
    __esModule: true,
    default: {
      Ros: function Ros() {
        return new MockRosClient();
      },
      Topic: function Topic(arg: { name: string }) {
        return new MockRosTopic(arg);
      },
    },
  };
});

describe("RosbridgePlayer", () => {
  let player: RosbridgePlayer;

  beforeEach(() => {
    player = new RosbridgePlayer({
      url: "ws://some-url",
      sourceId: "rosbridge-websocket",
    });
  });

  afterEach(() => {
    player.close();
  });

  it("closes a connection that is still being opened when the player closes", () => {
    const client = workerInstance;
    player.close();
    expect(client.closed).toBe(true);

    // The connection completing afterwards must not revive it either.
    client.closed = false;
    client.setup({ types: ["rosgraph_msgs/Log"] });
    expect(client.closed).toBe(true);
  });

  it("doesn't poll topics again when a request settles after close", async () => {
    vi.useFakeTimers();
    const addListener = vi.fn();
    vi.stubGlobal("document", {
      hidden: true,
      addEventListener: addListener,
      removeEventListener: vi.fn(),
    });
    onTestFinished(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });
    workerInstance.holdTopics = true;
    // rosgraph_msgs/Log identifies ROS 1, so no version warning.
    workerInstance.setup({ types: ["rosgraph_msgs/Log"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(workerInstance.settleTopics).toBeDefined();

    player.close();
    workerInstance.settleTopics?.();
    await vi.advanceTimersByTimeAsync(10_000);

    // A poll scheduled after close would wait for the hidden window here, leaking the player.
    expect(addListener).not.toHaveBeenCalledWith("visibilitychange", expect.anything(), {
      once: true,
    });
  });

  it("refreshes the node graph again after the connection drops mid-refresh", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const first = workerInstance;
    first.holdNodes = true;
    first.setup({ types: ["rosgraph_msgs/Log"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(first.nodeRequests).toBe(1);

    first.emitClose?.();
    (console.error as ReturnType<typeof vi.fn>).mockClear(); // the expected "Connection failed" alert
    await vi.advanceTimersByTimeAsync(3_000); // reconnect delay
    const second = workerInstance;
    expect(second).not.toBe(first);
    second.setup({ types: ["rosgraph_msgs/Log"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(second.nodeRequests).toBe(1);
  });

  it("ignores a topics answer from a connection that was replaced", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    let topics: string[] | undefined;
    player.setListener(async (state) => {
      topics = state.activeData?.topics.map(({ name }) => name);
    });
    const first = workerInstance;
    first.holdTopics = true;
    first.setup({ types: ["rosgraph_msgs/Log"] });
    first.emitClose?.();
    (console.error as ReturnType<typeof vi.fn>).mockClear(); // the expected "Connection failed" alert
    await vi.advanceTimersByTimeAsync(1_000); // first reconnect delay
    const second = workerInstance;
    expect(second).not.toBe(first);
    second.setup({ topics: ["/new"], types: ["rosgraph_msgs/Log"], typedefs: [HEADER_TYPEDEF] });
    await vi.advanceTimersByTimeAsync(200);
    expect(topics).toEqual(["/new"]);

    first.advertise({
      topics: ["/stale"],
      types: ["rosgraph_msgs/Log"],
      typedefs: [HEADER_TYPEDEF],
    });
    first.settleTopics?.();
    await vi.advanceTimersByTimeAsync(200);
    expect(topics).toEqual(["/new"]);
  });

  it("reconnects when the topics poll goes unanswered on a dead link", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const first = workerInstance;
    first.holdTopics = true;
    first.setup({ types: ["rosgraph_msgs/Log"] });
    await vi.advanceTimersByTimeAsync(ROSBRIDGE_DEAD_LINK_MS - 1);
    expect(workerInstance).toBe(first);
    await vi.advanceTimersByTimeAsync(1);
    (console.warn as ReturnType<typeof vi.fn>).mockClear(); // "no answer, reconnecting"
    (console.error as ReturnType<typeof vi.fn>).mockClear(); // the expected "Connection failed" alert
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000); // first reconnect delay
    expect(workerInstance).not.toBe(first);

    // The dead socket reporting its close later doesn't start another connection
    const second = workerInstance;
    first.emitClose?.();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(workerInstance).toBe(second);
  });

  it("backs off from a server that drops every connection right after it connects", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    onTestFinished(() => {
      vi.useRealTimers();
    });
    workerInstance.setup({ types: ["rosgraph_msgs/Log"] });
    for (const delay of [1_000, 2_000, 4_000]) {
      const previous = workerInstance;
      previous.emitClose?.();
      (console.error as ReturnType<typeof vi.fn>).mockClear(); // the expected "Connection failed"
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(workerInstance).toBe(previous);
      await vi.advanceTimersByTimeAsync(1);
      expect(workerInstance).not.toBe(previous);
      workerInstance.setup({ types: ["rosgraph_msgs/Log"] });
    }
  });

  it("keeps a link that streams data while the topics poll goes unanswered", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const first = workerInstance;
    first.setup({ topics: ["/a"], types: ["std_msgs/Header"], typedefs: [HEADER_TYPEDEF] });
    await vi.advanceTimersByTimeAsync(0);
    player.setSubscriptions([{ topic: "/a" }]);
    // rosapi stops answering, but data keeps arriving
    first.holdTopics = true;
    for (let i = 0; i < (2 * ROSBRIDGE_DEAD_LINK_MS) / 100; i++) {
      topicCallbacks.get("/a")?.(
        headerMessage({ seq: i, stamp: { sec: i, nsec: 0 }, frame_id: "f" }),
      );
      await vi.advanceTimersByTimeAsync(100);
    }
    (console.warn as ReturnType<typeof vi.fn>).mockClear(); // "taking too long" stall warning
    expect(first.closed).toBe(false);
    expect(workerInstance).toBe(first);

    // Once nothing arrives at all, the link is dead
    await vi.advanceTimersByTimeAsync(ROSBRIDGE_DEAD_LINK_MS);
    (console.warn as ReturnType<typeof vi.fn>).mockClear(); // "no answer, reconnecting"
    (console.error as ReturnType<typeof vi.fn>).mockClear(); // the expected "Connection failed" alert
    expect(first.closed).toBe(true);
  });

  it("looks up a large graph's services a few at a time", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    workerInstance.services = Array.from({ length: 100 }, (_, i) => `/service_${i}`);
    workerInstance.setup({ types: ["rosgraph_msgs/Log"] });
    await vi.advanceTimersByTimeAsync(0);

    let lookups = 0;
    while (workerInstance.pendingServiceTypes.length > 0) {
      expect(workerInstance.pendingServiceTypes.length).toBeLessThanOrEqual(8);
      lookups += workerInstance.pendingServiceTypes.length;
      workerInstance.pendingServiceTypes.splice(0).forEach((answer) => {
        answer();
      });
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(lookups).toBe(100);
  });

  it("polls again while hidden once a panel requests a topic that isn't advertised yet", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      hidden: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    onTestFinished(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });
    workerInstance.setup({
      topics: ["/a"],
      types: ["/std_msgs/Header", "rosgraph_msgs/Log"],
      typedefs: [HEADER_TYPEDEF],
    });
    await vi.advanceTimersByTimeAsync(3_000);
    // Every requested topic is advertised: polling waits for the window to be shown.
    const requests = workerInstance.topicRequests;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(workerInstance.topicRequests).toBe(requests);

    player.setSubscriptions([{ topic: "/b" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(workerInstance.topicRequests).toBeGreaterThan(requests);

    // A panel asking for /clock is waiting for it too, unlike the player's own /clock subscription.
    player.setSubscriptions([{ topic: "/a" }]);
    await vi.advanceTimersByTimeAsync(10_000);
    const settled = workerInstance.topicRequests;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(workerInstance.topicRequests).toBe(settled);
    player.setSubscriptions([{ topic: "/clock" }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(workerInstance.topicRequests).toBeGreaterThan(settled + 1);

    // /clock appears while still hidden: the next poll finds it and the player subscribes.
    subscribedTopics.length = 0;
    workerInstance.advertise({
      topics: ["/a", "/clock"],
      types: ["/std_msgs/Header", "/std_msgs/Header", "rosgraph_msgs/Log"],
      typedefs: [HEADER_TYPEDEF, HEADER_TYPEDEF],
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(subscribedTopics).toContain("/clock");
  });

  it("resubscribes a topic whose message definition changes", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    workerInstance.setup({
      topics: ["/t"],
      types: ["pkg/Msg", "rosgraph_msgs/Log"],
      typedefs: ["string text"],
      messages: [{ topic: "/t", message: textMessage({ text: "hi" }) }],
    });
    const received: unknown[] = [];
    player.setListener(async ({ activeData }) => {
      received.push(...(activeData?.messages ?? []).map(({ message }) => message));
    });
    player.setSubscriptions([{ topic: "/t" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toContainEqual({ text: "hi" });

    // An unchanged poll keeps the subscription
    subscribedTopics.length = 0;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(subscribedTopics).toEqual([]);

    // Same type name, rebuilt definition
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(42, 0);
    workerInstance.advertise({
      topics: ["/t"],
      types: ["pkg/Msg", "rosgraph_msgs/Log"],
      typedefs: ["uint32 n"],
      messages: [{ topic: "/t", message: { bytes } }],
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(subscribedTopics).toEqual(["/t"]);
    expect(received).toContainEqual({ n: 42 });
  });

  it("subscribes to topics without errors", async () => {
    workerInstance.setup({
      topics: ["/topic/A"],
      types: ["/std_msgs/Header", "rosgraph_msgs/Log"],
      typedefs: [
        `std_msgs/Header header

      ================================================================================
      MSG: std_msgs/Header
      uint32 seq
      time stamp
      string frame_id`,
      ],
    });

    const sig = Promise.withResolvers<void>();
    player.setSubscriptions([{ topic: "/topic/A" }]);
    player.setListener(async ({ activeData }) => {
      const { topics } = activeData ?? {};
      if (!topics) {
        return;
      }

      expect(topics).toStrictEqual<typeof topics>([
        { name: "/topic/A", schemaName: "/std_msgs/Header" },
      ]);
      sig.resolve();
    });

    await sig.promise;
  });

  describe("parsedMessages", () => {
    beforeEach(() => {
      workerInstance.setup({
        topics: ["/topic/A", "/topic/B"],
        types: ["/std_msgs/Header", "text", "rosgraph_msgs/Log"],
        typedefs: [
          `std_msgs/Header header

            ================================================================================
            MSG: std_msgs/Header
            uint32 seq
            time stamp
            string frame_id`,
          `string text`,
        ],
        messages: [
          {
            topic: "/topic/A",
            receiveTime: { sec: 100, nsec: 0 },
            message: headerMessage({
              seq: 7643,
              stamp: { sec: 1234, nsec: 5678 },
              frame_id: "someFrameId",
            }),
          },
          {
            topic: "/topic/B",
            receiveTime: { sec: 100, nsec: 0 },
            message: textMessage({ text: "some text" }),
          },
        ],
      });
    });

    it("returns parsedMessages with complex type", async () => {
      player.setSubscriptions([{ topic: "/topic/A" }]);

      const sig = Promise.withResolvers<void>();
      player.setListener(async ({ activeData }) => {
        const { messages } = activeData ?? {};
        if (!messages) {
          return;
        }

        expect(messages.length).toBe(1);
        expect(messages[0]?.message).toMatchObject({
          header: {
            seq: 7643,
            stamp: { sec: 1234, nsec: 5678 },
            frame_id: "someFrameId",
          },
        });

        sig.resolve();
      });
      await sig.promise;
    });

    it("returns parsedMessages with basic types", async () => {
      player.setSubscriptions([{ topic: "/topic/B" }]);

      const sig = Promise.withResolvers<void>();
      player.setListener(async ({ activeData }) => {
        const { messages } = activeData ?? {};
        if (!messages) {
          return;
        }

        expect(messages.length).toBe(1);
        expect(messages[0]?.message).toMatchObject({
          text: "some text",
        });

        sig.resolve();
      });
      await sig.promise;
    });
  });
});
