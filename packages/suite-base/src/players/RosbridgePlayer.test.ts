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

import RosbridgePlayer from "@lichtblick/suite-base/players/RosbridgePlayer";

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

  public on(op: string, callback: () => void) {
    if (op === "connection") {
      this.#connectCallback = callback;
    }
  }

  public close() {
    // no-op
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

  public getNodes(callback: (nodes: string[]) => void, _errCb: (error: Error) => void) {
    callback([]);
  }

  public getNodeDetails(
    _node: string,
    callback: (subscriptions: string[], publications: string[], services: string[]) => void,
    _errCb: (error: Error) => void,
  ) {
    callback([], [], []);
  }
}

class MockRosTopic {
  #name: string = "";

  public constructor({ name }: { name: string }) {
    this.#name = name;
  }

  public subscribe(callback: (arg: unknown) => void) {
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
      typedefs: [
        `std_msgs/Header header

      ================================================================================
      MSG: std_msgs/Header
      uint32 seq
      time stamp
      string frame_id`,
      ],
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
