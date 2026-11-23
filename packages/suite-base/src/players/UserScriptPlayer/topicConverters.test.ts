// SPDX-License-Identifier: MPL-2.0

import type * as Foxglove from "@foxglove/extension";

import FakePlayer from "@lichtblick/suite-base/components/MessagePipeline/FakePlayer";
import {
  MessageBlock,
  MessageEvent,
  PlayerState,
  PlayerStateActiveData,
  SubscribePayload,
} from "@lichtblick/suite-base/players/types";
import { buildContributionPoints } from "@lichtblick/suite-base/providers/helpers/buildContributionPoints";
import ExtensionBuilder from "@lichtblick/suite-base/testing/builders/ExtensionBuilder";

import UserScriptPlayer from ".";
import { schemaDescriptionToDatatypes } from "./topicConverters";

const userScriptActions = {
  setUserScriptDiagnostics: vi.fn(),
  addUserScriptLogs: vi.fn(),
  setUserScriptRosLib: vi.fn(),
  setUserScriptTypesLib: vi.fn(),
};

const input = (value: string, nsec: number): MessageEvent => ({
  topic: "/in",
  schemaName: "in.Msg",
  receiveTime: { sec: 0, nsec },
  message: { value },
  sizeInBytes: 1,
});

// Stable references: new topics/datatypes would look like a data source change and reset converters.
const topics = [{ name: "/in", schemaName: "in.Msg" }];
const datatypes = new Map();

const activeData = (messages: MessageEvent[]): PlayerStateActiveData => ({
  startTime: { sec: 0, nsec: 0 },
  endTime: { sec: 1, nsec: 0 },
  currentTime: { sec: 0, nsec: 0 },
  isPlaying: true,
  speed: 1,
  lastSeekTime: 0,
  totalBytesReceived: 0,
  messages,
  topics,
  topicStats: new Map(),
  datatypes,
});

function converterArgs(
  overrides: Partial<Foxglove.RegisterMessageConverterArgsTopic> = {},
): Foxglove.RegisterMessageConverterArgsTopic {
  return {
    type: "topic",
    inputTopics: ["/in"],
    outputTopic: "/out",
    outputSchemaName: "out.Msg",
    outputSchemaDescription: { value: "string" },
    // "two" emits two messages, "skip" none, anything else one.
    create: () => (event) => {
      const { value } = event.message as { value: string };
      if (value === "skip") {
        return undefined;
      }
      return value === "two" ? [{ value: "a" }, { value: "b" }] : { value };
    },
    ...overrides,
  };
}

async function setup(
  converter:
    | Foxglove.RegisterMessageConverterArgsTopic
    | Foxglove.RegisterMessageConverterArgsTopic[],
  subscriptions: SubscribePayload[] = [{ topic: "/out" }],
) {
  const fakePlayer = new FakePlayer();
  const player = new UserScriptPlayer(fakePlayer, userScriptActions);
  const states: PlayerState[] = [];
  player.setListener(async (state) => {
    states.push(state);
  });
  const converters = Array.isArray(converter) ? converter : [converter];
  await player.setTopicConverters(converters.map((c) => ({ extensionId: "ext", converter: c })));
  player.setSubscriptions(subscriptions);
  await Promise.resolve();
  return { fakePlayer, player, states };
}

/** Converter reading `/out` and appending "!" to its value, writing `/chained`. */
const chainedArgs = converterArgs({
  inputTopics: ["/out"],
  outputTopic: "/chained",
  create: () => (event) => ({ value: `${(event.message as { value: string }).value}!` }),
});

const values = (messages: readonly MessageEvent[], topic: string) =>
  messages.filter((m) => m.topic === topic).map((m) => (m.message as { value: string }).value);

describe("schemaDescriptionToDatatypes", () => {
  it("maps primitives, arrays and nested objects to datatypes", () => {
    expect(
      schemaDescriptionToDatatypes("out.Msg", {
        name: "string",
        values: ["number"],
        flag: "bool",
        raw: ["byte"],
        pos: { x: "number" },
        points: [{ y: "number" }],
      }),
    ).toEqual(
      new Map([
        [
          "out.Msg.pos",
          { name: "out.Msg.pos", definitions: [{ name: "x", type: "float64", isArray: false }] },
        ],
        [
          "out.Msg.points",
          { name: "out.Msg.points", definitions: [{ name: "y", type: "float64", isArray: false }] },
        ],
        [
          "out.Msg",
          {
            name: "out.Msg",
            definitions: [
              { name: "name", type: "string", isArray: false },
              { name: "values", type: "float64", isArray: true },
              { name: "flag", type: "bool", isArray: false },
              { name: "raw", type: "uint8", isArray: true },
              { name: "pos", type: "out.Msg.pos", isComplex: true, isArray: false },
              { name: "points", type: "out.Msg.points", isComplex: true, isArray: true },
            ],
          },
        ],
      ]),
    );
  });
});

describe("UserScriptPlayer topic converters", () => {
  it("lists the output topic with its schema and subscribes to the inputs", async () => {
    const { fakePlayer, states } = await setup(converterArgs());

    await fakePlayer.emit({ activeData: activeData([]) });

    const last = states.at(-1)!.activeData!;
    expect(last.topics).toContainEqual({ name: "/out", schemaName: "out.Msg" });
    expect(last.datatypes.get("out.Msg")).toEqual({
      name: "out.Msg",
      definitions: [{ name: "value", type: "string", isArray: false }],
    });
    expect(fakePlayer.subscriptions.map(({ topic }) => topic)).toEqual(["/in"]);
  });

  it("emits converted messages, expands arrays and drops undefined", async () => {
    const { fakePlayer, states } = await setup(converterArgs());

    await fakePlayer.emit({
      activeData: activeData([input("one", 1), input("skip", 2), input("two", 3)]),
    });

    const outputs = states.at(-1)!.activeData!.messages.filter(({ topic }) => topic === "/out");
    expect(
      outputs.map(({ message, schemaName, receiveTime }) => ({ message, schemaName, receiveTime })),
    ).toEqual([
      { message: { value: "one" }, schemaName: "out.Msg", receiveTime: { sec: 0, nsec: 1 } },
      { message: { value: "a" }, schemaName: "out.Msg", receiveTime: { sec: 0, nsec: 3 } },
      { message: { value: "b" }, schemaName: "out.Msg", receiveTime: { sec: 0, nsec: 3 } },
    ]);
  });

  it("creates the converter lazily and recreates it only when a watched variable changes", async () => {
    const create = vi.fn(converterArgs().create);
    const { fakePlayer, player } = await setup(converterArgs({ create, watchVariables: ["w"] }));
    expect(create).not.toHaveBeenCalled();

    player.setGlobalVariables({ w: 1, other: 1 });
    await fakePlayer.emit({ activeData: activeData([input("one", 1)]) });
    player.setGlobalVariables({ w: 1, other: 2 });
    await fakePlayer.emit({ activeData: activeData([input("one", 2)]) });
    expect(create).toHaveBeenCalledTimes(1);

    player.setGlobalVariables({ w: 2, other: 2 });
    await fakePlayer.emit({ activeData: activeData([input("one", 3)]) });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith({ w: 2, other: 2 });
  });

  it("reports a converter that throws as a player alert", async () => {
    const { fakePlayer, states } = await setup(
      converterArgs({
        create: () => () => {
          throw new Error("boom");
        },
      }),
    );

    await fakePlayer.emit({ activeData: activeData([input("one", 1)]) });

    expect(states.at(-1)!.alerts).toContainEqual(
      expect.objectContaining({ severity: "error", message: expect.stringContaining("/out") }),
    );
  });

  it("converts the full range through getBatchIterator", async () => {
    const { fakePlayer, player } = await setup(converterArgs());
    vi.spyOn(fakePlayer, "getBatchIterator").mockImplementation(() =>
      (async function* () {
        yield { type: "message-event" as const, msgEvent: input("one", 1) };
        yield { type: "message-event" as const, msgEvent: input("two", 2) };
      })(),
    );
    await fakePlayer.emit({ activeData: activeData([]) });

    const results = [];
    for await (const result of player.getBatchIterator("/out")!) {
      if (result.type === "message-event") {
        results.push(result.msgEvent.message);
      }
    }
    expect(results).toEqual([{ value: "one" }, { value: "a" }, { value: "b" }]);
  });

  it("rejects an output topic that already exists in the data source", async () => {
    const { fakePlayer, states } = await setup(converterArgs({ outputTopic: "/in" }));

    await fakePlayer.emit({ activeData: activeData([]) });

    expect(states.at(-1)!.alerts).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("already present") }),
    );
  });
});

describe("UserScriptPlayer chained topic converters", () => {
  it("runs a converter on another converter's output and subscribes to the source input", async () => {
    const { fakePlayer, states } = await setup(
      [chainedArgs, converterArgs()],
      [{ topic: "/chained" }],
    );

    await fakePlayer.emit({ activeData: activeData([input("one", 1), input("two", 2)]) });

    const { messages } = states.at(-1)!.activeData!;
    expect(values(messages, "/chained")).toEqual(["one!", "a!", "b!"]);
    // The intermediate topic is computed but only subscribed topics are emitted.
    expect(values(messages, "/out")).toEqual([]);
    expect(fakePlayer.subscriptions.map(({ topic }) => topic)).toEqual(["/in"]);
  });

  it("chains through getBatchIterator", async () => {
    const { fakePlayer, player } = await setup(
      [converterArgs(), chainedArgs],
      [{ topic: "/chained" }],
    );
    vi.spyOn(fakePlayer, "getBatchIterator").mockImplementation(() =>
      (async function* () {
        yield { type: "message-event" as const, msgEvent: input("one", 1) };
      })(),
    );
    await fakePlayer.emit({ activeData: activeData([]) });

    const results = [];
    for await (const result of player.getBatchIterator("/chained")!) {
      if (result.type === "message-event") {
        results.push(result.msgEvent.message);
      }
    }
    expect(results).toEqual([{ value: "one!" }]);
  });

  it("rejects converters that read their own output through a cycle", async () => {
    const { fakePlayer, states } = await setup(
      [
        converterArgs({ inputTopics: ["/b"], outputTopic: "/a" }),
        converterArgs({ inputTopics: ["/a"], outputTopic: "/b" }),
        converterArgs(),
      ],
      [{ topic: "/a" }, { topic: "/out" }],
    );

    await fakePlayer.emit({ activeData: activeData([input("one", 1)]) });

    const last = states.at(-1)!;
    expect(last.alerts?.filter(({ message }) => message.includes("cycle"))).toHaveLength(2);
    expect(last.activeData!.topics.map(({ name }) => name)).toEqual(["/in", "/out"]);
    expect(values(last.activeData!.messages, "/out")).toEqual(["one"]);
  });
});

describe("UserScriptPlayer topic converter backfill", () => {
  it("backfills the inputs and returns the last converted output per topic", async () => {
    const { fakePlayer, player } = await setup(
      [converterArgs(), chainedArgs],
      [{ topic: "/chained" }],
    );
    const backfill = vi.fn().mockResolvedValue([input("two", 1)]);
    (fakePlayer as unknown as { getBackfillMessages: typeof backfill }).getBackfillMessages =
      backfill;
    await fakePlayer.emit({ activeData: activeData([]) });

    const result = await player.getBackfillMessages({
      topics: new Map([
        ["/out", { topic: "/out" }],
        ["/chained", { topic: "/chained" }],
      ]),
      time: { sec: 0, nsec: 5 },
    });

    expect(backfill).toHaveBeenCalledWith({
      topics: new Map([["/in", { topic: "/in" }]]),
      time: { sec: 0, nsec: 5 },
    });
    expect(result.map(({ topic, message }) => ({ topic, message }))).toEqual([
      { topic: "/out", message: { value: "b" } },
      { topic: "/chained", message: { value: "b!" } },
    ]);
  });
});

describe("UserScriptPlayer topic converter preloading", () => {
  const failedAlert = (states: PlayerState[]) =>
    states.at(-1)!.alerts?.some(({ message }) => message.includes("failed")) === true;
  const block = (messages: MessageEvent[], needTopics = new Map()): MessageBlock => ({
    messagesByTopic: { "/in": messages },
    needTopics,
    sizeInBytes: messages.length,
  });

  it("adds converter outputs to fully loaded blocks and reuses them until a block changes", async () => {
    const create = vi.fn(converterArgs().create);
    const { fakePlayer, states } = await setup(converterArgs({ create }), [
      { topic: "/out", preloadType: "full" },
    ]);

    const loaded = block([input("one", 1), input("two", 2)]);
    const loading = block([], new Map([["/in", { topic: "/in" }]]));
    const messageCache = { startTime: { sec: 0, nsec: 0 }, blocks: [loaded, loading, undefined] };
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });

    expect(fakePlayer.subscriptions).toContainEqual({ topic: "/in", preloadType: "full" });
    const [first, second] = states.slice(-2).map((s) => s.progress.messageCache!);
    expect(values(first!.blocks[0]!.messagesByTopic["/out"]!, "/out")).toEqual(["one", "a", "b"]);
    expect(first!.blocks[0]!.sizeInBytes).toBe(5);
    expect(first!.blocks[1]).toBe(loading);
    expect(first!.blocks[2]).toBeUndefined();
    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps converted blocks across seeks and reconverts when a watched variable changes", async () => {
    const create = vi.fn(converterArgs().create);
    const { fakePlayer, player, states } = await setup(
      converterArgs({ create, watchVariables: ["scale"] }),
      [{ topic: "/out", preloadType: "full" }],
    );
    const messageCache = { startTime: { sec: 0, nsec: 0 }, blocks: [block([input("one", 1)])] };

    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });
    const converted = states.at(-1)!.progress.messageCache;
    await fakePlayer.emit({
      activeData: { ...activeData([]), lastSeekTime: 1 },
      progress: { messageCache },
    });
    expect(states.at(-1)!.progress.messageCache).toBe(converted);
    expect(create).toHaveBeenCalledTimes(1);

    player.setGlobalVariables({ scale: 2 });
    await fakePlayer.emit({
      activeData: { ...activeData([]), lastSeekTime: 1 },
      progress: { messageCache },
    });
    expect(states.at(-1)!.progress.messageCache).not.toBe(converted);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed block and its alert across seeks without converting it again", async () => {
    const create = vi.fn(() => (event: { message: unknown }) => {
      const { value } = event.message as { value: string };
      if (value === "bad") {
        throw new Error("bad input");
      }
      return { value };
    });
    const { fakePlayer, states } = await setup(converterArgs({ create }), [
      { topic: "/out", preloadType: "full" },
    ]);
    const messageCache = {
      startTime: { sec: 0, nsec: 0 },
      blocks: [block([input("good", 1)]), block([input("bad", 2)])],
    };

    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });
    expect(failedAlert(states)).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);

    // Same blocks, nothing changed: no reconversion on every frame.
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });
    expect(create).toHaveBeenCalledTimes(2);

    // A seek clears converter alerts, but not the failed block's.
    await fakePlayer.emit({
      activeData: { ...activeData([]), lastSeekTime: 1 },
      progress: { messageCache },
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(failedAlert(states)).toBe(true);
    expect(
      values(states.at(-1)!.progress.messageCache!.blocks[0]!.messagesByTopic["/out"]!, "/out"),
    ).toEqual(["good"]);
  });

  const failOnBad = () =>
    vi.fn(() => (event: { message: unknown }) => {
      const { value } = event.message as { value: string };
      if (value === "bad") {
        throw new Error("bad input");
      }
      return { value };
    });

  it("does not convert an unchanged failed block again when another block loads", async () => {
    const create = failOnBad();
    const { fakePlayer } = await setup(converterArgs({ create }), [
      { topic: "/out", preloadType: "full" },
    ]);
    const bad = block([input("bad", 1)]);
    const startTime = { sec: 0, nsec: 0 };
    await fakePlayer.emit({
      activeData: activeData([]),
      progress: { messageCache: { startTime, blocks: [bad, undefined] } },
    });
    expect(create).toHaveBeenCalledTimes(1);

    await fakePlayer.emit({
      activeData: activeData([]),
      progress: { messageCache: { startTime, blocks: [bad, block([input("good", 2)])] } },
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("caches a healthy block while a converter fails elsewhere at the same time", async () => {
    // The backfill's failing conversion is released from inside the block's first stage, so it
    // runs while the block's second (chained) stage is still awaited.
    const blockConverting = Promise.withResolvers<void>();
    const create = vi.fn(() => (event: { message: unknown }) => {
      const { value } = event.message as { value: string };
      if (value === "bad") {
        throw new Error("bad input");
      }
      blockConverting.resolve();
      return { value };
    });
    const { fakePlayer, player } = await setup(
      [converterArgs({ create }), chainedArgs],
      [{ topic: "/chained", preloadType: "full" }],
    );
    const good = block([input("good", 1)]);
    const startTime = { sec: 0, nsec: 0 };
    Object.assign(fakePlayer, {
      getBackfillMessages: async () => {
        await blockConverting.promise;
        return [input("bad", 0)];
      },
    });
    await fakePlayer.emit({ activeData: activeData([]) }); // registers the converters

    await Promise.all([
      player.getBackfillMessages({
        topics: new Map([["/out", { topic: "/out" }]]),
        time: { sec: 0, nsec: 0 },
      }),
      fakePlayer.emit({
        activeData: activeData([]),
        progress: { messageCache: { startTime, blocks: [good] } },
      }),
    ]);
    create.mockClear();

    await fakePlayer.emit({
      activeData: activeData([]),
      progress: { messageCache: { startTime, blocks: [good, undefined] } },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a converter with malformed names without breaking the others", async () => {
    const malformed = converterArgs({
      outputTopic: "/broken",
      watchVariables: "scale" as unknown as string[],
    });
    const { fakePlayer, states } = await setup(
      [converterArgs(), malformed],
      [
        { topic: "/out", preloadType: "full" },
        { topic: "/broken", preloadType: "full" },
      ],
    );
    const messageCache = { startTime: { sec: 0, nsec: 0 }, blocks: [block([input("one", 1)])] };

    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });

    const state = states.at(-1)!;
    const converted = state.progress.messageCache!.blocks[0]!.messagesByTopic;
    expect(values(converted["/out"]!, "/out")).toEqual(["one"]);
    expect(converted["/broken"]).toBeUndefined();
    expect(state.alerts?.map(({ message }) => message)).toContainEqual(
      expect.stringContaining("needs inputTopics and watchVariables to be lists of names"),
    );
  });

  it("converts a failed block again when a watched variable changes", async () => {
    let failing = true;
    const create = vi.fn((variables: Readonly<Record<string, unknown>>) => {
      return (event: { message: unknown }) => {
        if (failing) {
          throw new Error("not ready");
        }
        return { value: `${(event.message as { value: string }).value}:${String(variables.v)}` };
      };
    });
    const { fakePlayer, player, states } = await setup(
      converterArgs({ create, watchVariables: ["v"] }),
      [{ topic: "/out", preloadType: "full" }],
    );
    const messageCache = { startTime: { sec: 0, nsec: 0 }, blocks: [block([input("one", 1)])] };
    const outputs = () =>
      values(states.at(-1)!.progress.messageCache!.blocks[0]!.messagesByTopic["/out"]!, "/out");
    player.setGlobalVariables({ v: 1 });
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });
    expect(failedAlert(states)).toBe(true);

    failing = false;
    player.setGlobalVariables({ v: 2 });
    await fakePlayer.emit({
      activeData: { ...activeData([]), lastSeekTime: 1 },
      progress: { messageCache },
    });

    expect(outputs()).toEqual(["one:2"]);
    expect(failedAlert(states)).toBe(false);
  });

  it("clears a failed block's alert once its output is no longer preloaded", async () => {
    const create = vi.fn(() => () => {
      throw new Error("bad input");
    });
    const { fakePlayer, player, states } = await setup(converterArgs({ create }), [
      { topic: "/out", preloadType: "full" },
    ]);
    const messageCache = { startTime: { sec: 0, nsec: 0 }, blocks: [block([input("one", 1)])] };
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });
    expect(failedAlert(states)).toBe(true);

    player.setSubscriptions([{ topic: "/out" }]);
    await Promise.resolve();
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });

    expect(create).toHaveBeenCalledTimes(1);
    expect(failedAlert(states)).toBe(false);
  });

  it("stops adding converter outputs once the output is no longer preloaded", async () => {
    const { fakePlayer, player, states } = await setup(converterArgs(), [
      { topic: "/out", preloadType: "full" },
    ]);
    const messageCache = { startTime: { sec: 0, nsec: 0 }, blocks: [block([input("one", 1)])] };
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });
    expect(states.at(-1)!.progress.messageCache).not.toBe(messageCache);

    player.setSubscriptions([{ topic: "/out" }]);
    await Promise.resolve();
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });
    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });

    expect(states.at(-1)!.progress.messageCache).toBe(messageCache);
  });

  it("leaves blocks alone when the output is not preloaded", async () => {
    const { fakePlayer, states } = await setup(converterArgs());
    const messageCache = { startTime: { sec: 0, nsec: 0 }, blocks: [block([input("one", 1)])] };

    await fakePlayer.emit({ activeData: activeData([]), progress: { messageCache } });

    expect(states.at(-1)!.progress.messageCache).toBe(messageCache);
  });
});

describe("buildContributionPoints topic converters", () => {
  it("collects type: topic converters separately from schema converters", async () => {
    const extension = ExtensionBuilder.extensionInfo();
    const result = await buildContributionPoints(
      extension,
      `module.exports = { activate: (ctx) => {
        ctx.registerMessageConverter({ type: "schema", fromSchemaName: "a", toSchemaName: "b", converter: (m) => m });
        ctx.registerMessageConverter({ type: "topic", inputTopics: ["/in"], outputTopic: "/out", outputSchemaName: "b", create: () => () => undefined });
      } };`,
    );

    expect(result.messageConverters).toEqual([
      expect.objectContaining({ fromSchemaName: "a", toSchemaName: "b" }),
    ]);
    expect(result.topicConverters).toEqual([
      {
        extensionId: extension.id,
        converter: expect.objectContaining({ type: "topic", outputTopic: "/out" }),
      },
    ]);
  });
});
