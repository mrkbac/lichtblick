// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import roslib from "@foxglove/roslibjs";
import SocketAdapter from "@foxglove/roslibjs/src/core/SocketAdapter";
import { parse as parseMessageDefinition } from "@foxglove/rosmsg";
import { MessageReader as ROS1MessageReader } from "@foxglove/rosmsg-serialization";
import { Time, fromMillis, toSec } from "@foxglove/rostime";
import { Semaphore } from "async-mutex";
import * as _ from "lodash-es";

import { debouncePromise } from "@lichtblick/den/async";
import { filterMap } from "@lichtblick/den/collection";
import Log from "@lichtblick/log";
import { createRos2CdrDeserializer } from "@lichtblick/mcap-support";
import { ParameterValue } from "@lichtblick/suite";
import ExtensionProxySocket, {
  needsExtensionProxy,
} from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/ExtensionProxySocket";
import {
  reconnectDelayMs,
  STABLE_CONNECTION_MS,
} from "@lichtblick/suite-base/players/LiveConnectionBackend";
import {
  LIVE_QUEUE_MAX_BYTES,
  LiveMessageQueue,
} from "@lichtblick/suite-base/players/LiveMessageQueue";
import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import {
  RosapiTypeDef,
  rosapiTypeDefsToDatatypes,
} from "@lichtblick/suite-base/players/rosapiTypeDefs";
import {
  AdvertiseOptions,
  MessageEvent,
  Player,
  PlayerState,
  PublishPayload,
  SubscribePayload,
  PlayerPresence,
  ServiceTypeInfo,
  TopicStats,
  TopicWithSchemaName,
} from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { bagConnectionsToDatatypes } from "@lichtblick/suite-base/util/bagConnectionsHelper";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";
import { toError } from "@lichtblick/suite-base/util/toError";

const log = Log.getLogger(__dirname);

/** Topics the player subscribes to itself when they are available. */
const INTERNAL_TOPICS: readonly string[] = ["/clock"];

type MessageDecoder = { readMessage: (data: Uint8Array) => unknown };

// Services whose rosapi lookups run at once
const SERVICE_LOOKUP_CONCURRENCY = 8;

const CAPABILITIES = [PLAYER_CAPABILITIES.advertise, PLAYER_CAPABILITIES.callServices];

type RosNodeDetails = Record<
  "subscriptions" | "publications" | "services",
  { node: string; values: string[] }
>;

function collateNodeDetails(
  details: RosNodeDetails[],
  key: keyof RosNodeDetails,
): Map<string, Set<string>> {
  return _.transform(
    details,
    (acc, detail) => {
      const { node, values } = detail[key];
      for (const value of values) {
        if (!acc.has(value)) {
          acc.set(value, new Set());
        }
        acc.get(value)?.add(node);
      }
    },
    new Map<string, Set<string>>(),
  );
}

function isClockMessage(topic: string, msg: unknown): msg is { clock: Time } {
  const maybeClockMsg = msg as { clock?: Time };
  return topic === "/clock" && maybeClockMsg.clock != undefined && !isNaN(maybeClockMsg.clock.sec);
}

/**
 * The topics poll (every 3 s while the window is shown) unanswered this long, with no message
 * received in that time either: the link is dead, reconnect. A link that still streams data is
 * alive, only rosapi (a separate node) is slow or hung. A dead mobile link can leave the socket open for minutes before the browser notices.
 */
export const ROSBRIDGE_DEAD_LINK_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined;
}

// Connects to `rosbridge_server` instance using `roslibjs`. Currently doesn't support seeking or
// showing simulated time, so current time from Date.now() is always used instead. Also doesn't yet
// support raw ROS messages; instead we use the CBOR compression provided by roslibjs, which
// unmarshalls into plain JS objects.
// A worker can't reach the proxy extension, so a ws:// URL the https page can't open runs on the
// main thread through it, with the handlers roslib would attach to its own socket.
function proxiedRos(url: string): roslib.Ros {
  const ros = new roslib.Ros({ transportLibrary: "websocket" });
  ros.socket = Object.assign(new ExtensionProxySocket(url), SocketAdapter(ros));
  return ros;
}

export default class RosbridgePlayer implements Player {
  #url: string; // WebSocket URL.
  #rosClient?: roslib.Ros; // The roslibjs client when we're connected.
  #latestClient?: roslib.Ros; // The newest roslibjs client, connected or still connecting.
  /** Ends the current connection now, as if it had closed, and reconnects. */
  #dropConnection?: () => void;
  /** Reconnects since the last successful connection, for the backoff. */
  #reconnectAttempts = 0;
  /** When the current connection last received anything, for the dead-link check */
  #lastReceivedAtMs = 0;
  #id: string = randomUUID(); // Unique ID for this player.
  #isRefreshing = false; // True if currently refreshing the node graph.
  /** Rejecters of requests in flight on the current connection, failed when it closes. */
  #pendingRequests = new Set<(error: Error) => void>();
  #listener?: (arg0: PlayerState) => Promise<void>; // Listener for _emitState().
  #closed: boolean = false; // Whether the player has been completely closed using close().
  #providerTopics?: TopicWithSchemaName[]; // Topics as published by the WebSocket.
  #providerTopicsStats = new Map<string, TopicStats>(); // topic names to topic statistics.
  // Topic stats handed out last; a new Map only when a count changed, so consumers compare by reference.
  #emittedTopicsStats = new Map<string, TopicStats>();
  #topicsStatsChanged = false;
  #providerDatatypes?: RosDatatypes; // Datatypes as published by the WebSocket.
  #publishedTopics = new Map<string, Set<string>>(); // A map of topic names to the set of publisher IDs publishing each topic.
  #subscribedTopics = new Map<string, Set<string>>(); // A map of topic names to the set of subscriber IDs subscribed to each topic.
  #services = new Map<string, Set<string>>(); // A map of service names to service provider IDs that provide each service.
  // With the definition text each reader was built from, so an unchanged type keeps its reader
  #messageReadersByDatatype = new Map<string, { definition: string; reader: MessageDecoder }>();
  #start?: Time; // The time at which we started playing.
  #clockTime?: Time; // The most recent published `/clock` time, if available
  // active subscriptions
  // With the reader each was made with: a topic whose type or definition changes is resubscribed
  #topicSubscriptions = new Map<string, { topic: roslib.Topic; reader: MessageDecoder }>();
  #requestedSubscriptions: SubscribePayload[] = []; // Requested subscriptions by setSubscriptions()
  // Subscriptions the player added for itself (#addInternalSubscriptions), not requested by a panel.
  readonly #internalSubscriptions = new WeakSet<SubscribePayload>();
  #requestTopicsTimeout?: ReturnType<typeof setTimeout>; // setTimeout() handle for _requestTopics().
  // Polls topics once a hidden window is shown again; removed on reconnect and close.
  #requestTopicsOnShow?: () => void;
  // active publishers for the current connection
  #topicPublishers = new Map<string, roslib.Topic>();
  // which topics we want to advertise to other nodes
  #advertisements: AdvertiseOptions[] = [];
  #parsedTopics = new Set<string>();
  #receivedBytes: number = 0;
  #presence: PlayerPresence = PlayerPresence.NOT_PRESENT;
  #alerts = new PlayerAlertManager();
  // Messages that we'll send in the next emitState() call.
  readonly #parsedMessages = new LiveMessageQueue(LIVE_QUEUE_MAX_BYTES, this.#alerts);
  #emitTimer?: ReturnType<typeof setTimeout>;
  #serviceTypeCache = new Map<string, Promise<string>>();
  #serviceDetailsCache = new Map<string, Promise<RosapiTypeDef[]>>();
  #serviceTypes = new Map<string, ServiceTypeInfo>(); // Request/response schemas by service name.
  #serviceDatatypes: RosDatatypes = new Map(); // Datatypes of service requests/responses.
  readonly #sourceId: string;
  #rosVersion: 1 | 2 | undefined;

  public constructor({
    url,
    sourceId,
  }: {
    url: string;
    sourceId: string;
  }) {
    this.#presence = PlayerPresence.INITIALIZING;
    this.#url = url;
    this.#start = fromMillis(Date.now());
    this.#sourceId = sourceId;
    this.#open();
  }

  #open = (): void => {
    if (this.#closed) {
      return;
    }
    if (this.#rosClient != undefined) {
      throw new Error(`Attempted to open a second Rosbridge connection`);
    }
    this.#alerts.removeAlert("rosbridge:connection-failed");
    log.info(`Opening connection to ${this.#url}`);

    // `workersocket` will open the actual WebSocket connection in a WebWorker.
    const rosClient = needsExtensionProxy(this.#url)
      ? proxiedRos(this.#url)
      : new roslib.Ros({ url: this.#url, transportLibrary: "workersocket" });
    this.#latestClient = rosClient;

    rosClient.on("error", (err) => {
      if (err) {
        this.#alerts.addAlert("rosbridge:error", {
          severity: "warn",
          message: "Rosbridge error",
          error: err,
        });
        this.#emitState();
      }
    });

    // Once per client: a dropped connection's socket may still report its close much later
    let handledClose = false;
    let connectedAtMs: number | undefined;
    const onClose = () => {
      if (handledClose) {
        return;
      }
      handledClose = true;
      if (connectedAtMs != undefined && Date.now() - connectedAtMs >= STABLE_CONNECTION_MS) {
        // Only a connection that stayed up resets the backoff: a server that drops every client
        // right after it connects is retried ever more slowly
        this.#reconnectAttempts = 0;
      }
      this.#presence = PlayerPresence.RECONNECTING;

      this.#cancelTopicsPoll();
      for (const [topicName, { topic }] of this.#topicSubscriptions) {
        topic.unsubscribe();
        this.#topicSubscriptions.delete(topicName);
      }
      rosClient.close(); // ensure the underlying worker is cleaned up
      this.#rosClient = undefined;
      const closedError = new Error("Connection closed");
      for (const reject of this.#pendingRequests) {
        reject(closedError);
      }
      this.#pendingRequests.clear();
      this.#isRefreshing = false;
      this.#serviceTypeCache.clear();
      this.#serviceDetailsCache.clear();
      // Services may change type on reconnect. A new #services map also makes in-flight
      // #resolveServiceTypes calls discard their results.
      this.#services = new Map();
      this.#serviceTypes = new Map();
      this.#serviceDatatypes = new Map();

      this.#alerts.addAlert("rosbridge:connection-failed", {
        severity: "error",
        message: "Connection failed",
        tip: `Check that the rosbridge WebSocket server at ${this.#url} is reachable.`,
      });

      this.#emitState();

      // Try connecting again.
      setTimeout(this.#open, reconnectDelayMs(this.#reconnectAttempts++));
    };
    rosClient.on("close", onClose);

    rosClient.on("connection", () => {
      log.info(`Connected to ${this.#url}`);
      if (this.#closed) {
        // Closed while connecting: drop the socket and its worker
        rosClient.close();
        return;
      }
      this.#presence = PlayerPresence.PRESENT;
      this.#alerts.removeAlert("rosbridge:connection-failed");
      this.#alerts.removeAlert("rosbridge:error");
      this.#rosClient = rosClient;
      this.#dropConnection = onClose;
      connectedAtMs = Date.now();
      this.#lastReceivedAtMs = Date.now();

      this.#setupPublishers();
      void this.#requestTopics({ forceUpdate: true });
    });
  };

  async #requestTopics(opt?: { forceUpdate: boolean }): Promise<void> {
    const { forceUpdate = false } = opt ?? {};
    // clear alerts before each topics request so we don't have stale alerts from previous failed requests
    this.#alerts.removeAlerts((id) => id.startsWith("requestTopics:"));

    this.#cancelTopicsPoll();
    const rosClient = this.#rosClient;
    if (!rosClient || this.#closed) {
      return;
    }

    // getTopicsAndRawTypes might silently hang. When this happens, there is no indication to the user
    // that the connection is doing anything and studio shows no errors and no data.
    // This logic adds a warning after 5 seconds (picked arbitrarily) to display a notice to the user.
    const topicsStallWarningTimeout = setTimeout(() => {
      this.#alerts.addAlert("topicsAndRawTypesTimeout", {
        severity: "warn",
        message: "Taking too long to get topics and raw types.",
      });

      this.#emitState();
    }, 5000);
    let deadLinkTimeout: ReturnType<typeof setTimeout>;
    const checkDeadLink = () => {
      if (!this.#isCurrentClient(rosClient)) {
        return;
      }
      const silentMs = Date.now() - this.#lastReceivedAtMs;
      if (silentMs < ROSBRIDGE_DEAD_LINK_MS) {
        deadLinkTimeout = setTimeout(checkDeadLink, ROSBRIDGE_DEAD_LINK_MS - silentMs);
        return;
      }
      log.warn(`No answer from ${this.#url} for ${ROSBRIDGE_DEAD_LINK_MS / 1000} s, reconnecting`);
      this.#dropConnection?.();
    };
    deadLinkTimeout = setTimeout(checkDeadLink, ROSBRIDGE_DEAD_LINK_MS);

    try {
      const result = await new Promise<{
        topics: string[];
        types: string[];
        typedefs_full_text: string[];
      }>((resolve, reject) => {
        rosClient.getTopicsAndRawTypes(resolve, reject);
      });

      clearTimeout(topicsStallWarningTimeout);
      clearTimeout(deadLinkTimeout);
      if (!this.#isCurrentClient(rosClient)) {
        return; // an answer from a closed or replaced connection
      }
      this.#alerts.removeAlert("topicsAndRawTypesTimeout");

      const topicsMissingDatatypes: string[] = [];
      const topics: TopicWithSchemaName[] = [];
      const datatypeDescriptions = [];

      // Automatically detect the ROS version based on the datatypes.
      // The rosbridge server itself publishes /rosout so the topic should be reliably present.
      const previousRosVersion = this.#rosVersion;
      if (result.types.includes("rcl_interfaces/msg/Log")) {
        this.#rosVersion = 2;
        this.#alerts.removeAlert("unknownRosVersion");
      } else if (result.types.includes("rosgraph_msgs/Log")) {
        this.#rosVersion = 1;
        this.#alerts.removeAlert("unknownRosVersion");
      } else {
        this.#rosVersion = 1;
        this.#alerts.addAlert("unknownRosVersion", {
          severity: "warn",
          message: "Unable to detect ROS version, assuming ROS 1",
        });
      }

      for (let i = 0; i < result.topics.length; i++) {
        const topicName = result.topics[i]!;
        const type = result.types[i];
        const messageDefinition = result.typedefs_full_text[i];

        if (type == undefined || messageDefinition == undefined) {
          topicsMissingDatatypes.push(topicName);
          continue;
        }
        topics.push({ name: topicName, schemaName: type });
        datatypeDescriptions.push({ type, messageDefinition });
      }

      // We call requestTopics on a timeout to check for new topics. If there are no changes to topics
      // we want to bail and avoid parsing definitions, updating readers, subscribers, etc.
      // However, during a re-connect, we _do_ want to refresh this list and re-subscribe
      const sortedTopics = _.sortBy(topics, "name");
      // The same definition text reads differently in ROS 1 and 2
      if (this.#rosVersion !== previousRosVersion) {
        this.#messageReadersByDatatype.clear();
      }
      const definitions = new Map<string, string>();
      for (const { type, messageDefinition } of datatypeDescriptions) {
        if (!definitions.has(type)) {
          definitions.set(type, messageDefinition);
        }
      }
      const previousReaders = this.#messageReadersByDatatype;
      if (
        !forceUpdate &&
        _.isEqual(this.#providerTopics, sortedTopics) &&
        definitions.size === previousReaders.size &&
        [...definitions].every(
          ([type, definition]) => previousReaders.get(type)?.definition === definition,
        )
      ) {
        return;
      }

      const messageReaders = new Map<string, { definition: string; reader: MessageDecoder }>();
      for (const [type, definition] of definitions) {
        const previous = previousReaders.get(type);
        if (previous?.definition === definition) {
          messageReaders.set(type, previous);
          continue;
        }
        const parsedDefinition = parseMessageDefinition(definition, {
          ros2: this.#rosVersion === 2,
        });
        messageReaders.set(type, {
          definition,
          reader:
            this.#rosVersion !== 2
              ? new ROS1MessageReader(parsedDefinition)
              : { readMessage: createRos2CdrDeserializer(parsedDefinition) },
        });
      }

      if (topicsMissingDatatypes.length > 0) {
        this.#alerts.addAlert("requestTopics:missing-types", {
          severity: "warn",
          message: "Could not resolve all message types",
          tip: `Message types could not be found for these topics: ${topicsMissingDatatypes.join(
            ",",
          )}`,
        });
      }

      // Remove stats entries for removed topics
      const topicsSet = new Set<string>(topics.map((topic) => topic.name));
      for (const topic of this.#providerTopicsStats.keys()) {
        if (!topicsSet.has(topic)) {
          this.#topicsStatsChanged = true;
          this.#providerTopicsStats.delete(topic);
        }
      }

      this.#providerTopics = sortedTopics;

      // Topic datatypes take precedence over service datatypes of the same name
      this.#providerDatatypes = new Map([
        ...this.#serviceDatatypes,
        ...bagConnectionsToDatatypes(datatypeDescriptions, { ros2: this.#rosVersion === 2 }),
      ]);
      this.#messageReadersByDatatype = messageReaders;

      // Try subscribing again, since we might now be able to subscribe to some new topics.
      this.setSubscriptions(this.#requestedSubscriptions);

      // Refresh the full graph topology
      this.#refreshSystemState().catch((error: unknown) => {
        log.error(error);
      });
    } catch (error) {
      log.error(error);
      clearTimeout(topicsStallWarningTimeout);
      clearTimeout(deadLinkTimeout);
      if (!this.#isCurrentClient(rosClient)) {
        return;
      }
      this.#alerts.removeAlert("topicsAndRawTypesTimeout");

      this.#alerts.addAlert("requestTopics:error", {
        severity: "error",
        message: "Failed to fetch topics from rosbridge",
        error: toError(error),
      });
    } finally {
      this.#emitState();

      // Regardless of what happens, request topics again in a little bit. A hidden window polls
      // again as soon as it is shown, instead of every 3 s in the background, unless a panel waits
      // for a topic that isn't advertised yet (it is subscribed as soon as it appears).
      // Not after close or a reconnect: that connection's cleanup already ran.
      if (this.#isCurrentClient(rosClient)) {
        this.#requestTopicsTimeout = setTimeout(() => {
          if (isDocumentHidden() && !this.#waitingForTopic()) {
            this.#requestTopicsOnShow = () => void this.#requestTopics();
            document.addEventListener("visibilitychange", this.#requestTopicsOnShow, {
              once: true,
            });
          } else {
            void this.#requestTopics();
          }
        }, 3000);
      }
    }
  }

  // Potentially performance-sensitive; await can be expensive
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  #emitState = debouncePromise(() => {
    if (!this.#listener || this.#closed) {
      return Promise.resolve();
    }

    const providerTopics = this.#providerTopics;
    const providerDatatypes = this.#providerDatatypes;
    const start = this.#start;
    if (!providerTopics || !providerDatatypes || !start) {
      return this.#listener({
        name: this.#url,
        presence: this.#presence,
        progress: {},
        capabilities: CAPABILITIES,
        profile: undefined,
        playerId: this.#id,
        activeData: undefined,
        alerts: this.#alerts.alerts(),
        urlState: {
          sourceId: this.#sourceId,
          parameters: { url: this.#url },
        },
      });
    }

    // When connected
    // Time is always moving forward even if we don't get messages from the server.
    if (this.#presence === PlayerPresence.PRESENT) {
      if (this.#emitTimer != undefined) {
        clearTimeout(this.#emitTimer);
      }
      this.#emitTimer = setTimeout(this.#emitState, 100);
    }

    const currentTime = this.#getCurrentTime();
    const messages = this.#parsedMessages.drain();
    if (this.#topicsStatsChanged) {
      this.#topicsStatsChanged = false;
      this.#emittedTopicsStats = new Map(this.#providerTopicsStats);
    }
    return this.#listener({
      name: this.#url,
      presence: this.#presence,
      progress: {},
      capabilities: CAPABILITIES,
      profile: this.#rosVersion === 2 ? "ros2" : "ros1",
      playerId: this.#id,
      alerts: this.#alerts.alerts(),
      urlState: {
        sourceId: this.#sourceId,
        parameters: { url: this.#url },
      },

      activeData: {
        messages,
        totalBytesReceived: this.#receivedBytes,
        startTime: start,
        endTime: currentTime,
        currentTime,
        isPlaying: true,
        speed: 1,
        // We don't support seeking, so we need to set this to any fixed value. Just avoid 0 so
        // that we don't accidentally hit falsy checks.
        lastSeekTime: 1,
        topics: providerTopics,
        topicStats: this.#emittedTopicsStats,
        datatypes: providerDatatypes,
        publishedTopics: this.#publishedTopics,
        subscribedTopics: this.#subscribedTopics,
        services: this.#services,
        serviceTypes: this.#serviceTypes,
      },
    });
  });

  public setListener(listener: (arg0: PlayerState) => Promise<void>): void {
    this.#listener = listener;
    this.#emitState();
  }

  /** Whether `rosClient` is still this open player's connection (not closed or replaced). */
  #isCurrentClient(rosClient: unknown): boolean {
    return !this.#closed && this.#rosClient === rosClient;
  }

  /**
   * Whether a panel requested a topic the server doesn't advertise yet. Subscriptions the player
   * adds for itself don't count: they are often never published (e.g. no /clock outside
   * simulation). The same topic requested by a panel does.
   */
  #waitingForTopic(): boolean {
    const advertised = new Set(this.#providerTopics?.map((topic) => topic.name));
    return this.#requestedSubscriptions.some(
      (sub) => !advertised.has(sub.topic) && !this.#internalSubscriptions.has(sub),
    );
  }

  #cancelTopicsPoll(): void {
    clearTimeout(this.#requestTopicsTimeout);
    this.#requestTopicsTimeout = undefined;
    if (this.#requestTopicsOnShow) {
      document.removeEventListener("visibilitychange", this.#requestTopicsOnShow);
      this.#requestTopicsOnShow = undefined;
    }
  }

  public close(): void {
    this.#closed = true;
    this.#cancelTopicsPoll();
    this.#latestClient?.close();
    if (this.#emitTimer != undefined) {
      clearTimeout(this.#emitTimer);
      this.#emitTimer = undefined;
    }
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    this.#requestedSubscriptions = subscriptions;

    if (!this.#rosClient || this.#closed) {
      return;
    }

    // Polling waits for a hidden window to be shown: a newly requested topic that isn't advertised
    // yet needs polling now, so it is subscribed as soon as it appears.
    if (this.#requestTopicsOnShow != undefined && this.#waitingForTopic()) {
      void this.#requestTopics();
    }

    // Only what panels asked for reaches them: /clock (subscribed for the player's own clock)
    // can arrive at up to 1 kHz
    this.#parsedTopics = new Set(subscriptions.map(({ topic }) => topic));

    // Subscribe to additional topics used by RosbridgePlayer itself; on a copy, so the caller's
    // list stays as it passed it
    const withInternal = [...subscriptions];
    this.#addInternalSubscriptions(withInternal);

    // See what topics we actually can subscribe to.
    const availableTopicsByTopicName = _.keyBy(this.#providerTopics ?? [], ({ name }) => name);
    const topicNames = withInternal
      .map(({ topic }) => topic)
      .filter((topicName) => availableTopicsByTopicName[topicName]);

    // Subscribe to all topics that we aren't subscribed to yet.
    for (const topicName of topicNames) {
      const availTopic = availableTopicsByTopicName[topicName];
      if (!availTopic) {
        continue;
      }

      const { schemaName } = availTopic;
      const messageReader = this.#messageReadersByDatatype.get(schemaName)?.reader;
      if (!messageReader) {
        continue;
      }
      // Readers are rebuilt only when a type's definition changes, so the same reader means the
      // topic's type and definition are unchanged
      const existing = this.#topicSubscriptions.get(topicName);
      if (existing?.reader === messageReader) {
        continue;
      }
      existing?.topic.unsubscribe();
      const topic = new roslib.Topic({
        ros: this.#rosClient,
        name: topicName,
        compression: "cbor-raw",
      });

      const alertId = `message:${topicName}`;
      topic.subscribe((message) => {
        this.#lastReceivedAtMs = Date.now();
        if (!this.#providerTopics) {
          return;
        }
        try {
          const buffer = (message as { bytes: ArrayBuffer }).bytes;
          const bytes = new Uint8Array(buffer);
          const innerMessage = messageReader.readMessage(bytes);

          // handle clock messages before choosing receiveTime so the clock can set its own receive time
          if (isClockMessage(topicName, innerMessage)) {
            const time = innerMessage.clock;
            const seconds = toSec(innerMessage.clock);
            if (!isNaN(seconds)) {
              if (this.#clockTime == undefined) {
                this.#start = time;
              }

              this.#clockTime = time;
            }
          }
          const receiveTime = this.#getCurrentTime();

          if (this.#parsedTopics.has(topicName)) {
            const msg: MessageEvent = {
              topic: topicName,
              receiveTime,
              message: innerMessage,
              schemaName,
              sizeInBytes: bytes.byteLength,
            };
            this.#parsedMessages.push(msg);
          }
          this.#alerts.removeAlert(alertId);

          // Update the message count for this topic
          let stats = this.#providerTopicsStats.get(topicName);
          if (this.#topicSubscriptions.has(topicName)) {
            if (!stats) {
              stats = { numMessages: 0 };
              this.#providerTopicsStats.set(topicName, stats);
            }
            stats.numMessages++;
            this.#topicsStatsChanged = true;
          }
        } catch (error) {
          this.#alerts.addAlert(alertId, {
            severity: "error",
            message: `Failed to parse message on ${topicName}`,
            error: toError(error),
          });
        }

        this.#emitState();
      });
      this.#topicSubscriptions.set(topicName, { topic, reader: messageReader });
    }

    // Unsubscribe from topics that we are subscribed to but shouldn't be.
    for (const [topicName, { topic }] of this.#topicSubscriptions) {
      if (!topicNames.includes(topicName)) {
        topic.unsubscribe();
        this.#topicSubscriptions.delete(topicName);

        // Reset the message count for this topic
        this.#topicsStatsChanged = true;
        this.#providerTopicsStats.delete(topicName);
      }
    }
  }

  public setPublishers(publishers: AdvertiseOptions[]): void {
    // Since `setPublishers` is rarely called, we can get away with just throwing away the old
    // Roslib.Topic objects and creating new ones.
    for (const publisher of this.#topicPublishers.values()) {
      publisher.unadvertise();
    }
    this.#topicPublishers.clear();
    this.#advertisements = publishers;
    this.#setupPublishers();
  }

  public setParameter(_key: string, _value: ParameterValue): void {
    throw new Error("Parameter editing is not supported by the Rosbridge connection");
  }

  public publish({ topic, msg }: PublishPayload): void {
    const publisher = this.#topicPublishers.get(topic);
    if (!publisher) {
      if (this.#advertisements.some((opts) => opts.topic === topic)) {
        // Topic was advertised but the connection is not yet established
        return;
      }
      throw new Error(
        `Tried to publish on a topic that is not registered as a publisher: ${topic}`,
      );
    }
    publisher.publish(msg);
  }

  // Query the type name for this service. Cache the query to avoid looking it up again.
  async #getServiceType(service: string): Promise<string> {
    if (!this.#rosClient) {
      throw new Error("Not connected");
    }

    const existing = this.#serviceTypeCache.get(service);
    if (existing) {
      return await existing;
    }

    const rosClient = this.#rosClient;
    const serviceTypePromise = this.#request<string>((resolve, reject) => {
      rosClient.getServiceType(service, resolve, reject);
    });

    this.#serviceTypeCache.set(service, serviceTypePromise);
    serviceTypePromise.catch(() => {
      if (this.#serviceTypeCache.get(service) === serviceTypePromise) {
        this.#serviceTypeCache.delete(service);
      }
    });

    return await serviceTypePromise;
  }

  async #getServiceDetails(
    serviceType: string,
    kind: "request" | "response",
  ): Promise<RosapiTypeDef[]> {
    const rosClient = this.#rosClient;
    if (!rosClient) {
      throw new Error("Not connected");
    }
    const key = `${kind}:${serviceType}`;
    let promise = this.#serviceDetailsCache.get(key);
    if (!promise) {
      promise = this.#request<RosapiTypeDef[]>((resolve, reject) => {
        const onResult = (result: { typedefs: RosapiTypeDef[] }) => {
          resolve(result.typedefs);
        };
        if (kind === "request") {
          rosClient.getServiceRequestDetails(serviceType, onResult, reject);
        } else {
          rosClient.getServiceResponseDetails(serviceType, onResult, reject);
        }
      });
      this.#serviceDetailsCache.set(key, promise);
      // Don't cache failures, so the next node graph refresh retries
      const cached = promise;
      cached.catch(() => {
        if (this.#serviceDetailsCache.get(key) === cached) {
          this.#serviceDetailsCache.delete(key);
        }
      });
    }
    return await promise;
  }

  // Look up request/response definitions of services via rosapi, so panels can build request
  // templates. Lookups are cached; services without rosapi details are left out.
  async #resolveServiceTypes(): Promise<void> {
    const services = this.#services;
    const missing = [...services.keys()].filter((name) => !this.#serviceTypes.has(name));
    const stale = [...this.#serviceTypes.keys()].some((name) => !services.has(name));
    if (missing.length === 0 && !stale) {
      return;
    }

    // A large graph has hundreds of services: look up a few at a time, not flood rosbridge
    const lookups = new Semaphore(SERVICE_LOOKUP_CONCURRENCY);
    const results = await Promise.allSettled(
      missing.map(
        async (name) =>
          await lookups.runExclusive(async () => {
            const type = await this.#getServiceType(name);
            const [request, response] = await Promise.all([
              this.#getServiceDetails(type, "request"),
              this.#getServiceDetails(type, "response"),
            ]);
            return { name, type, request, response };
          }),
      ),
    );
    if (this.#services !== services) {
      return; // graph changed meanwhile; the next refresh resolves again
    }

    const serviceTypes = new Map([...this.#serviceTypes].filter(([name]) => services.has(name)));
    const serviceDatatypes = new Map(this.#serviceDatatypes);
    for (const result of results) {
      if (result.status !== "fulfilled") {
        continue;
      }
      const { name, type, request, response } = result.value;
      for (const [datatype, definition] of rosapiTypeDefsToDatatypes([...request, ...response])) {
        serviceDatatypes.set(datatype, definition);
      }
      serviceTypes.set(name, {
        type,
        requestSchemaName: request[0]?.type,
        responseSchemaName: response[0]?.type,
      });
    }
    this.#serviceTypes = serviceTypes;
    this.#serviceDatatypes = serviceDatatypes;
    if (this.#providerDatatypes) {
      this.#providerDatatypes = new Map([...serviceDatatypes, ...this.#providerDatatypes]);
    }
    this.#emitState();
  }

  public async callService(service: string, request: unknown): Promise<unknown> {
    if (!this.#rosClient) {
      throw new Error("Not connected");
    }

    if (!isRecord(request)) {
      throw new Error("RosbridgePlayer#callService request must be an object");
    }

    const serviceType = await this.#getServiceType(service);

    // Create a proxy object for dispatching our service call
    const proxy = new roslib.Service({
      ros: this.#rosClient,
      name: service,
      serviceType,
    });

    // Send the service request
    return await this.#request<Record<string, unknown>>((resolve, reject) => {
      proxy.callService(
        request,
        (response: Record<string, unknown>) => {
          resolve(response);
        },
        (error: Error) => {
          reject(error);
        },
      );
    });
  }

  public getBatchIterator(): undefined {
    // RosbridgePlayer does not support batch iteration
    return undefined;
  }

  #setupPublishers(): void {
    // This function will be called again once a connection is established
    if (!this.#rosClient) {
      return;
    }

    if (this.#advertisements.length <= 0) {
      return;
    }

    for (const { topic, schemaName: datatype } of this.#advertisements) {
      const roslibTopic = new roslib.Topic({
        ros: this.#rosClient,
        name: topic,
        messageType: datatype,
        queue_size: 0,
      });
      this.#topicPublishers.set(topic, roslibTopic);
      roslibTopic.advertise();
    }
  }

  #addInternalSubscriptions(subscriptions: SubscribePayload[]): void {
    // Always subscribe to /clock if available
    for (const topic of INTERNAL_TOPICS) {
      if (subscriptions.find((sub) => sub.topic === topic) == undefined) {
        const sub = { topic };
        this.#internalSubscriptions.add(sub);
        subscriptions.unshift(sub);
      }
    }
  }

  #getCurrentTime(): Time {
    return this.#clockTime ?? fromMillis(Date.now());
  }

  // Refreshes the full system state graph. Runs in the background so we don't
  // block app startup while mapping large node graphs.
  async #refreshSystemState(): Promise<void> {
    const rosClient = this.#rosClient;
    if (this.#isRefreshing || !rosClient) {
      return;
    }
    try {
      this.#isRefreshing = true;

      const nodes = await this.#request<string[]>((resolve, reject) => {
        rosClient.getNodes((fetchedNodes) => {
          resolve(fetchedNodes);
        }, reject);
      });

      const promises = nodes.map(async (node) => {
        return await this.#request<RosNodeDetails>((resolve, reject) => {
          rosClient.getNodeDetails(
            node,
            (subscriptions, publications, services) => {
              resolve({
                publications: { node, values: publications },
                services: { node, values: services },
                subscriptions: { node, values: subscriptions },
              });
            },
            reject,
          );
        });
      });

      const results = await Promise.allSettled(promises);
      if (this.#rosClient !== rosClient) {
        return; // the connection closed meanwhile; the next one refreshes again
      }
      const fulfilled = filterMap(results, (item) =>
        item.status === "fulfilled" ? item.value : undefined,
      );
      this.#publishedTopics = collateNodeDetails(fulfilled, "publications");
      this.#subscribedTopics = collateNodeDetails(fulfilled, "subscriptions");
      this.#services = collateNodeDetails(fulfilled, "services");

      this.#emitState();
      void this.#resolveServiceTypes();
    } catch (error) {
      if (this.#rosClient !== rosClient) {
        return; // "Connection closed": the connection alert already explains it
      }
      this.#alerts.addAlert("requestTopics:system-state", {
        severity: "error",
        message: "Failed to fetch node details from rosbridge",
        error: toError(error),
      });
    } finally {
      if (this.#rosClient === rosClient) {
        this.#isRefreshing = false;
      }
    }
  }

  /** A rosbridge request that also rejects when the connection closes before it settles. */
  async #request<T>(
    start: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      this.#pendingRequests.add(reject);
      start(
        (value) => {
          this.#pendingRequests.delete(reject);
          resolve(value);
        },
        (error) => {
          this.#pendingRequests.delete(reject);
          reject(error);
        },
      );
    });
  }
}

/** Whether the window is hidden; false outside a browser (tests). */
function isDocumentHidden(): boolean {
  return (globalThis as { document?: Document }).document?.hidden === true;
}
