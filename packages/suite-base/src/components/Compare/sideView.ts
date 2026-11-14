// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable, MessageEvent } from "@lichtblick/suite";
import { MessagePipelineContext } from "@lichtblick/suite-base/components/MessagePipeline/types";
import { prefixTopic } from "@lichtblick/suite-base/players/IterablePlayer/shared/ComparedSource";
import {
  MessageBlock,
  PlayerState,
  SubscribePayload,
  Topic,
  TopicStats,
} from "@lichtblick/suite-base/players/types";

type Block = Immutable<MessageBlock> | undefined;

/**
 * What one side of a comparison looks like to a panel: its own topics without their prefix
 * (`/b/odom` is `/odom`), other sides' topics hidden. Topics outside every side (e.g. user script
 * outputs) stay as they are, and so does a topic already named with a side prefix, so a path
 * dragged from the topic list (`/b/odom`) still works.
 *
 * One instance per side is shared by every panel showing that side, so each message is copied
 * (to rename its topic) at most once per side.
 */
export class SideView {
  readonly #prefix: string;
  readonly #prefixes: readonly string[];
  /** Appended to subscriber ids, so each side's copy of a panel has its own subscriptions */
  readonly #idSuffix: string;
  #topicNames = new Set<string>();

  readonly #events = new WeakMap<Immutable<MessageEvent>, Immutable<MessageEvent>>();
  readonly #eventArrays = new WeakMap<
    readonly Immutable<MessageEvent>[],
    readonly Immutable<MessageEvent>[]
  >();
  readonly #blocks = new WeakMap<object, Block>();
  #lastBlocks?: { input: readonly Block[]; output: readonly Block[] };
  readonly #topicLists = new WeakMap<readonly Immutable<Topic>[], Immutable<Topic>[]>();
  readonly #statsMaps = new WeakMap<object, Map<string, Immutable<TopicStats>>>();
  readonly #playerStates = new WeakMap<object, Immutable<PlayerState>>();
  readonly #byId = new WeakMap<object, Map<string, Immutable<MessageEvent[]>>>();
  readonly #publics = new WeakMap<object, MessagePipelineContext>();
  readonly #functions = new WeakMap<object, unknown>();

  /** `prefix` of this side among the `prefixes` of every side, e.g. "/b" of ["/a", "/b"] */
  public constructor(prefix: string, prefixes: readonly string[]) {
    this.#prefix = prefix;
    this.#prefixes = prefixes;
    this.#idSuffix = `@compare${prefix}`;
  }

  /** The topic a panel of this side reads for `topic` */
  public toSide(topic: string): string {
    if (this.#sideOf(topic) != undefined) {
      return topic;
    }
    const prefixed = prefixTopic(this.#prefix, topic);
    // Before topics are known, and for topics of this side, prefix; keep topics outside all sides
    return this.#topicNames.has(topic) && !this.#topicNames.has(prefixed) ? topic : prefixed;
  }

  /** The name panels of this side see for `topic`, or undefined if it belongs to another side */
  public fromSide(topic: string): string | undefined {
    const side = this.#sideOf(topic);
    if (side == undefined) {
      return topic;
    }
    if (side !== this.#prefix) {
      return undefined;
    }
    // A recorded topic that itself starts like another side (`/b/a/odom`) keeps its prefix, so
    // it never takes the name of that side's topic (`/a/odom`)
    const name = topic.slice(side.length);
    return this.#sideOf(name) != undefined ? topic : name;
  }

  public mapPublic(context: MessagePipelineContext): MessagePipelineContext {
    const known = this.#publics.get(context);
    if (known) {
      return known;
    }
    this.#topicNames = new Set(context.sortedTopics.map((topic) => topic.name));
    const mapped: MessagePipelineContext = {
      ...context,
      sortedTopics: this.#mapTopics(context.sortedTopics),
      playerState: this.#mapPlayerState(context.playerState),
      messageEventsBySubscriberId: this.#mapById(context.messageEventsBySubscriberId),
      setSubscriptions: this.#wrap(
        context.setSubscriptions,
        (setSubscriptions) => (id: string, payloads: Immutable<SubscribePayload[]>) => {
          setSubscriptions(
            `${id}${this.#idSuffix}`,
            payloads.map((payload) => ({ ...payload, topic: this.toSide(payload.topic) })),
          );
        },
      ),
      getBatchIterator: this.#wrap(
        context.getBatchIterator,
        (getBatchIterator) => (topic, options) =>
          this.#mapIterator(getBatchIterator(this.toSide(topic), options)),
      ),
      getMessageAtTime: this.#wrap(
        context.getMessageAtTime,
        (getMessageAtTime) => async (topic, time, abortSignal) => {
          const event = await getMessageAtTime(this.toSide(topic), time, abortSignal);
          return event && this.#mapEvent(event);
        },
      ),
      getInspectionIterator:
        context.getInspectionIterator &&
        this.#wrap(
          context.getInspectionIterator,
          (getInspectionIterator) => (topics, options) =>
            this.#mapIterator(
              getInspectionIterator(
                topics.map((topic) => this.toSide(topic)),
                options,
              ),
            ),
        ),
    };
    this.#publics.set(context, mapped);
    return mapped;
  }

  #sideOf(topic: string): string | undefined {
    return this.#prefixes.find((prefix) => topic.startsWith(`${prefix}/`));
  }

  // Same wrapper for the same function, so selectors of it don't see a change every frame
  #wrap<F extends object>(fn: F, make: (fn: F) => F): F {
    const known = this.#functions.get(fn) as F | undefined;
    if (known) {
      return known;
    }
    const wrapped = make(fn);
    this.#functions.set(fn, wrapped);
    return wrapped;
  }

  #mapEvent(event: Immutable<MessageEvent>): Immutable<MessageEvent> {
    const known = this.#events.get(event);
    if (known) {
      return known;
    }
    const topic = this.fromSide(event.topic) ?? event.topic;
    const mapped = topic === event.topic ? event : { ...event, topic };
    this.#events.set(event, mapped);
    return mapped;
  }

  // This side's events renamed; others (e.g. explicitly subscribed `/a/x` in side B) as they are
  #mapEvents(events: readonly Immutable<MessageEvent>[]): readonly Immutable<MessageEvent>[] {
    const known = this.#eventArrays.get(events);
    if (known) {
      return known;
    }
    const mapped = events.map((event) => this.#mapEvent(event));
    this.#eventArrays.set(events, mapped);
    return mapped;
  }

  async *#mapIterator<T extends { type: string }>(
    iterator: AsyncIterableIterator<T> | undefined,
  ): AsyncIterableIterator<T> {
    if (!iterator) {
      return;
    }
    try {
      for await (const result of iterator) {
        if (result.type === "message-event") {
          const withEvent = result as T & { msgEvent: Immutable<MessageEvent> };
          yield { ...withEvent, msgEvent: this.#mapEvent(withEvent.msgEvent) };
        } else {
          yield result;
        }
      }
    } finally {
      await iterator.return?.();
    }
  }

  #mapTopics(topics: readonly Immutable<Topic>[]): Immutable<Topic>[] {
    const known = this.#topicLists.get(topics);
    if (known) {
      return known;
    }
    const own = new Map<string, Immutable<Topic>>();
    for (const topic of topics) {
      const name = this.fromSide(topic.name);
      // This side's `/a/x` wins over an unprefixed `/x`
      if (name != undefined && (name !== topic.name || !own.has(name))) {
        own.set(name, name === topic.name ? topic : { ...topic, name });
      }
    }
    const mapped = [...own.values()];
    this.#topicLists.set(topics, mapped);
    return mapped;
  }

  #mapStats(stats: ReadonlyMap<string, Immutable<TopicStats>>): Map<string, Immutable<TopicStats>> {
    const known = this.#statsMaps.get(stats);
    if (known) {
      return known;
    }
    const mapped = new Map<string, Immutable<TopicStats>>();
    for (const [topic, value] of stats) {
      const name = this.fromSide(topic);
      if (name != undefined && (name !== topic || !mapped.has(name))) {
        mapped.set(name, value);
      }
    }
    this.#statsMaps.set(stats, mapped);
    return mapped;
  }

  #mapBlock(block: Block): Block {
    if (!block) {
      return undefined;
    }
    const known = this.#blocks.get(block);
    if (known) {
      return known;
    }
    const messagesByTopic: Record<string, readonly Immutable<MessageEvent>[]> = {};
    for (const [topic, events] of Object.entries(block.messagesByTopic)) {
      // Other sides' topics keep their prefixed names, which never clash with this side's
      const name = this.fromSide(topic) ?? topic;
      if (name !== topic || messagesByTopic[name] == undefined) {
        // ponytail: copies each preloaded event of a shown topic once per side to rename it;
        // switch to renaming in the block consumers if that memory shows up in profiles
        messagesByTopic[name] = events.map((event) => this.#mapEvent(event));
      }
    }
    const mapped = { ...block, messagesByTopic } as Block;
    this.#blocks.set(block, mapped);
    return mapped;
  }

  // Blocks arrays are filled in place, so compare their entries instead of the array
  #mapBlocks(blocks: readonly Block[]): readonly Block[] {
    const last = this.#lastBlocks;
    if (
      last &&
      last.input.length === blocks.length &&
      blocks.every((block, index) => block === last.input[index])
    ) {
      return last.output;
    }
    const output = blocks.map((block) => this.#mapBlock(block));
    this.#lastBlocks = { input: [...blocks], output };
    return output;
  }

  #mapPlayerState(state: Immutable<PlayerState>): Immutable<PlayerState> {
    const known = this.#playerStates.get(state);
    if (known) {
      return known;
    }
    const { activeData, progress } = state;
    const cache = progress.messageCache;
    const mapped: Immutable<PlayerState> = {
      ...state,
      progress: cache
        ? { ...progress, messageCache: { ...cache, blocks: this.#mapBlocks(cache.blocks) } }
        : progress,
      activeData: activeData && {
        ...activeData,
        messages: this.#mapEvents(activeData.messages),
        topics: this.#mapTopics(activeData.topics),
        topicStats: this.#mapStats(activeData.topicStats),
      },
    };
    this.#playerStates.set(state, mapped);
    return mapped;
  }

  // Only the subscribers of this side, under the ids the panels gave
  #mapById(
    byId: ReadonlyMap<string, readonly Immutable<MessageEvent>[]>,
  ): Map<string, Immutable<MessageEvent[]>> {
    const known = this.#byId.get(byId);
    if (known) {
      return known;
    }
    const mapped = new Map<string, Immutable<MessageEvent[]>>();
    for (const [id, events] of byId) {
      if (id.endsWith(this.#idSuffix)) {
        mapped.set(id.slice(0, -this.#idSuffix.length), this.#mapEvents(events));
      }
    }
    this.#byId.set(byId, mapped);
    return mapped;
  }
}
