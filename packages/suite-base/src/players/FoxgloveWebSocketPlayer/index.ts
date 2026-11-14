// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { MessageDefinition, isMsgDefEqual } from "@foxglove/message-definition";
import CommonRosTypes from "@foxglove/rosmsg-msgs-common";
import { MessageWriter as Ros1MessageWriter } from "@foxglove/rosmsg-serialization";
import { MessageWriter as Ros2MessageWriter } from "@foxglove/rosmsg2-serialization";
import {
  compare,
  fromMillis,
  fromNanoSec,
  isGreaterThan,
  isLessThan,
  Time,
  toNanoSec,
} from "@foxglove/rostime";
import {
  ChannelId,
  FoxgloveClient,
  ServerCapability,
  SubscriptionId,
  ServiceCallPayload,
  ServiceCallRequest,
  ServiceCallResponse,
  Parameter,
  StatusLevel,
  FetchAssetStatus,
  FetchAssetResponse,
  BinaryOpcode,
  IWebSocket,
} from "@foxglove/ws-protocol";
import { IWritable, McapWriter } from "@mcap/core";
import * as _ from "lodash-es";

import { debouncePromise } from "@lichtblick/den/async";
import Log from "@lichtblick/log";
import { parseChannel } from "@lichtblick/mcap-support";
import { ParameterValue } from "@lichtblick/suite";
import { Asset } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import {
  LIVE_QUEUE_MAX_BYTES,
  LiveMessageQueue,
} from "@lichtblick/suite-base/players/LiveMessageQueue";
import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import {
  HeapUsage,
  heapLimitBytes,
  LiveHistoryBuffer,
} from "@lichtblick/suite-base/players/liveHistory/LiveHistoryBuffer";
import { LiveRecorder } from "@lichtblick/suite-base/players/liveHistory/LiveRecorder";
import {
  formatLiveHistoryMemory,
  liveHistorySettings,
} from "@lichtblick/suite-base/players/liveHistory/liveHistorySettings";
import { supportsLiveRecording } from "@lichtblick/suite-base/players/liveHistory/liveRecordings";
import { estimateObjectSize } from "@lichtblick/suite-base/players/messageMemoryEstimation";
import {
  AdvertiseOptions,
  MessageEvent,
  Player,
  PlayerPresence,
  PlayerAlert,
  PlayerState,
  PublishPayload,
  ServiceTypeInfo,
  SubscribePayload,
  Topic,
  TopicStats,
} from "@lichtblick/suite-base/players/types";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";
import { ros2CommonDatatypes } from "@lichtblick/suite-base/util/ros2CommonDatatypes";
import rosDatatypesToMessageDefinition from "@lichtblick/suite-base/util/rosDatatypesToMessageDefinition";
import { toError } from "@lichtblick/suite-base/util/toError";

import ExtensionProxySocket, {
  needsExtensionProxy,
  PROXY_MISSING_REASON,
} from "./ExtensionProxySocket";
import { JsonMessageWriter } from "./JsonMessageWriter";
import WorkerSocketAdapter from "./WorkerSocketAdapter";
import {
  FALLBACK_PUBLICATION_ENCODING,
  GET_ALL_PARAMS_PERIOD_MS,
  GET_ALL_PARAMS_REQUEST_ID,
  ROS_ENCODINGS,
  SUBSCRIPTION_WARNING_SUPPRESSION_MS,
  SUPPORTED_PUBLICATION_ENCODINGS,
  SUPPORTED_SERVICE_ENCODINGS,
  ZERO_TIME,
} from "./constants";
import { dataTypeToFullName, statusLevelToAlertSeverity } from "./helpers";
import {
  decodePlaybackState,
  encodePlaybackControlRequest,
  isPlaybackStateMessage,
  PLAYBACK_CONTROL_CAPABILITY,
  PlaybackServerInfo,
  PlaybackState,
  PlaybackStatus,
} from "./playbackControl";
import {
  MessageWriter,
  MessageDefinitionMap,
  Publication,
  ResolvedChannel,
  ResolvedService,
} from "./types";

const log = Log.getLogger(__dirname);
const textEncoder = new TextEncoder();

/** How often history playback advances, in ms. */
const HISTORY_TICK_MS = 16;
/** A server clock that hasn't ticked for this long, while messages arrive, is reported as stale. */
const CLOCK_STALE_MS = 3000;

/** How often the browser heap is checked, in ms. */
const HEAP_CHECK_MS = 5000;
const MIB = 1024 * 1024;

const secToNs = (sec: number) => BigInt(Math.round(sec * 1e9));

/** Chrome-only (`performance.memory`); undefined elsewhere. */
const readHeapUsage = (): HeapUsage | undefined =>
  (performance as { memory?: HeapUsage } | undefined)?.memory;

export default class FoxgloveWebSocketPlayer implements Player {
  readonly #sourceId: string;

  #url: string; // WebSocket URL.
  /** Name the server gives itself, once known. */
  #serverName?: string;
  #name: string;
  #client?: FoxgloveClient; // The client when we're connected.
  #id: string = randomUUID(); // Unique ID for this player session.
  #serverCapabilities: string[] = [];
  #playerCapabilities: (typeof PLAYER_CAPABILITIES)[keyof typeof PLAYER_CAPABILITIES][] = [];
  #supportedEncodings?: string[];
  #listener?: (arg0: PlayerState) => Promise<void>; // Listener for _emitState().
  #closed: boolean = false; // Whether the player has been completely closed using close().
  #topics?: Topic[]; // Topics as published by the WebSocket.
  #topicsStats = new Map<string, TopicStats>(); // Topic names to topic statistics, mutated in place.
  #emittedTopicsStats = new Map<string, TopicStats>(); // Copy of #topicsStats from the last emit.
  #topicsStatsChanged = false;
  #datatypes: MessageDefinitionMap = new Map(); // Datatypes as published by the WebSocket.
  #receivedBytes: number = 0;
  #presence: PlayerPresence = PlayerPresence.INITIALIZING;
  #alerts = new PlayerAlertManager();
  // Messages that we'll send in the next emitState() call.
  readonly #parsedMessages = new LiveMessageQueue(LIVE_QUEUE_MAX_BYTES, this.#alerts);
  #numTimeSeeks = 0;
  #profile?: string;
  #urlState: PlayerState["urlState"];

  /** Earliest time seen */
  #startTime?: Time;
  /** Latest time seen */
  #endTime?: Time;
  /* The most recent published time, if available */
  #clockTime?: Time;
  /* Flag indicating if the server publishes time messages */
  #serverPublishesTime = false;
  /* The raw socket, kept to send playback control requests the client library doesn't know about */
  #ws?: IWebSocket;
  /* Flag indicating if the server advertises the `playbackControl` capability */
  #serverControlsPlayback = false;
  #isPlaying = true;
  #speed = 1;

  /** Rolling history of received messages, to pause, seek and play in while connected. */
  #history = new LiveHistoryBuffer({
    windowNs: secToNs(liveHistorySettings.getState().windowSec),
    maxBytes: liveHistorySettings.getState().maxMiB * MIB,
  });
  /** Limit imposed on the history while the browser heap is nearly full. */
  #heapLimitBytes?: number;
  #lastHeapCheckMs = 0;
  #unsubscribeHistorySettings: () => void;
  /** Playback position while reviewing history; undefined while live. */
  #historyCursor?: Time;
  /** Raw payload of each history message, released together with the message. */
  #rawByMessage = new WeakMap<MessageEvent, { data: Uint8Array; channel: ResolvedChannel }>();
  /** Wall time of the current connection, for session stats. */
  #connectedAtMs?: number;
  /** Records the current connection to browser storage; one file per connection. */
  #recorder?: LiveRecorder;
  /** Set once the recorder couldn't be started, so it isn't retried for every message. */
  #recorderUnavailable = false;
  /** Newest message handed to panels, to catch them up after a pause. */
  #lastDelivered?: MessageEvent;
  #historyTimer?: ReturnType<typeof setTimeout>;
  #historyTickMs = 0;
  /** Wall time of the last server time message (or of connecting), to detect a stale clock. */
  #lastClockWallMs = Date.now();

  #unresolvedSubscriptions = new Set<string>();
  #resolvedSubscriptionsByTopic = new Map<string, SubscriptionId>();
  #resolvedSubscriptionsById = new Map<SubscriptionId, ResolvedChannel>();
  #channelsByTopic = new Map<string, ResolvedChannel>();
  #channelsById = new Map<ChannelId, ResolvedChannel>();
  #unsupportedChannelIds = new Set<ChannelId>();
  #recentlyCanceledSubscriptions = new Set<SubscriptionId>();
  #parameters = new Map<string, ParameterValue>();
  #getParameterInterval?: ReturnType<typeof setInterval>;
  #openTimeout?: ReturnType<typeof setInterval>;
  #connectionAttemptTimeout?: ReturnType<typeof setInterval>;
  #unresolvedPublications: AdvertiseOptions[] = [];
  #publicationsByTopic = new Map<string, Publication>();
  #serviceCallEncoding?: string;
  #servicesByName = new Map<string, ResolvedService>();
  #serviceResponseCbs = new Map<
    ServiceCallRequest["callId"],
    (response: ServiceCallResponse) => void
  >();
  #publishedTopics?: Map<string, Set<string>>;
  #subscribedTopics?: Map<string, Set<string>>;
  #advertisedServices?: Map<string, Set<string>>;
  #serviceTypes = new Map<string, ServiceTypeInfo>();
  #nextServiceCallId = 0;
  #nextAssetRequestId = 0;
  #fetchAssetRequests = new Map<number, (response: FetchAssetResponse) => void>();
  #fetchedAssets = new Map<string, Promise<Asset>>();
  #parameterTypeByName = new Map<string, Parameter["type"]>();
  #messageSizeEstimateByTopic: Record<string, number> = {};

  public constructor({
    url,
    sourceId,
  }: {
    url: string;
    sourceId: string;
  }) {
    this.#url = url;
    this.#name = url;
    this.#sourceId = sourceId;
    this.#urlState = {
      sourceId: this.#sourceId,
      parameters: { url: this.#url },
    };
    this.#unsubscribeHistorySettings = liveHistorySettings.subscribe(({ windowSec, diskMiB }) => {
      if (diskMiB === 0) {
        this.#stopRecording();
      }
      this.#history.setWindow(secToNs(windowSec));
      this.#applyHistoryMemoryLimit();
      this.#emitState();
    });
    this.#open();
  }

  #open = (): void => {
    if (this.#closed) {
      return;
    }
    if (this.#client != undefined) {
      throw new Error(`Attempted to open a second Foxglove WebSocket connection`);
    }
    log.info(`Opening connection to ${this.#url}`);

    // Set a timeout to abort the connection if we are still not connected by then.
    // This will abort hanging connection attempts that can for whatever reason not
    // establish a connection with the server.
    this.#connectionAttemptTimeout = setTimeout(() => {
      this.#client?.close();
    }, 10000);

    const subprotocols = [FoxgloveClient.SUPPORTED_SUBPROTOCOL, "foxglove.sdk.v1"];

    const ws = needsExtensionProxy(this.#url)
      ? new ExtensionProxySocket(this.#url, subprotocols)
      : typeof Worker !== "undefined"
        ? new WorkerSocketAdapter(this.#url, subprotocols)
        : (new WebSocket(this.#url, subprotocols) as IWebSocket);
    this.#ws = ws;
    this.#client = new FoxgloveClient({ ws });

    // FoxgloveClient emits an error for opcodes it doesn't know, so intercept playback state
    // messages before they reach it.
    const clientOnMessage = ws.onmessage;
    ws.onmessage = (event: unknown) => {
      const data = (event as { data: unknown }).data;
      if (isPlaybackStateMessage(data)) {
        if (this.#serverControlsPlayback) {
          this.#handlePlaybackState(decodePlaybackState(data));
        }
        return;
      }
      clientOnMessage?.(event);
    };

    this.#client.on("open", () => {
      if (this.#closed) {
        return;
      }
      if (this.#connectionAttemptTimeout != undefined) {
        clearTimeout(this.#connectionAttemptTimeout);
      }
      this.#presence = PlayerPresence.PRESENT;
      this.#resetSessionState();
      this.#connectedAtMs = Date.now();
      this.#stopRecording();
      this.#recorderUnavailable = false; // a new connection tries recording again
      this.#alerts.clear();
      this.#channelsById.clear();
      this.#channelsByTopic.clear();
      this.#servicesByName.clear();
      this.#serviceResponseCbs.clear();
      this.#publicationsByTopic.clear();
      for (const topic of this.#resolvedSubscriptionsByTopic.keys()) {
        this.#unresolvedSubscriptions.add(topic);
      }
      this.#resolvedSubscriptionsById.clear();
      this.#resolvedSubscriptionsByTopic.clear();

      // Re-assign members that are emitted as player state
      this.#profile = undefined;
      this.#publishedTopics = undefined;
      this.#subscribedTopics = undefined;
      this.#advertisedServices = undefined;
      this.#serviceTypes = new Map();
      this.#datatypes = new Map();
      this.#parameters = new Map();
    });

    this.#client.on("error", (err) => {
      log.error(err);

      if (
        (err as unknown as undefined | { message?: string })?.message != undefined &&
        err.message.includes("insecure WebSocket connection")
      ) {
        this.#alerts.addAlert("ws:connection-failed", {
          severity: "error",
          message: "Insecure WebSocket connection",
          tip: `Check that the WebSocket server at ${
            this.#url
          } is reachable and supports protocol version one of: ${subprotocols.join(", ")}.`,
        });
        this.#emitState();
      }
    });

    // Note: We've observed closed being called not only when an already open connection is closed
    // but also when a new connection fails to open
    //
    // Note: We explicitly avoid clearing state like start/end times, datatypes, etc to preserve
    // this during a disconnect event. Any necessary state clearing is handled once a new connection
    // is established
    this.#client.on("close", (event) => {
      log.info("Connection closed:", event);
      this.#presence = PlayerPresence.RECONNECTING;
      this.#stopRecording();
      this.#connectedAtMs = undefined;

      if (this.#getParameterInterval != undefined) {
        clearInterval(this.#getParameterInterval);
        this.#getParameterInterval = undefined;
      }
      if (this.#connectionAttemptTimeout != undefined) {
        clearTimeout(this.#connectionAttemptTimeout);
      }

      this.#client?.close();
      this.#client = undefined;
      this.#serverControlsPlayback = false;

      this.#alerts.addAlert("ws:connection-failed", {
        severity: "error",
        message: "Connection failed",
        tip:
          (event as { reason?: unknown } | undefined)?.reason === PROXY_MISSING_REASON
            ? `Browsers block ws:// from an https page. Install the WebSocket proxy extension (chrome-extension/ in the Lichtblick repo) and reload the page, or use wss://.`
            : `Check that the WebSocket server at ${
                this.#url
              } is reachable and supports protocol version one of: ${subprotocols.join(", ")}.`,
      });

      this.#emitState();
      this.#openTimeout = setTimeout(this.#open, 3000);
    });

    this.#client.on("serverInfo", (event) => {
      if (!Array.isArray(event.capabilities)) {
        this.#alerts.addAlert("ws:invalid-capabilities", {
          severity: "warn",
          message: `Server sent an invalid or missing capabilities field: '${event.capabilities}'`,
        });
      }

      const newSessionId = event.sessionId ?? randomUUID();
      if (this.#id !== newSessionId) {
        this.#resetSessionState();
      }

      this.#id = newSessionId;
      this.#name = `${this.#url}\n${event.name}`;
      this.#serverName = event.name;
      this.#serverCapabilities = Array.isArray(event.capabilities) ? event.capabilities : [];
      this.#serverPublishesTime = this.#serverCapabilities.includes(ServerCapability.time);
      this.#supportedEncodings = event.supportedEncodings;
      this.#datatypes = new Map();

      // If the server publishes the time we clear any existing clockTime we might have and let the
      // server override
      if (this.#serverPublishesTime) {
        this.#clockTime = undefined;
      }

      const maybeRosDistro = event.metadata?.["ROS_DISTRO"];
      if (maybeRosDistro) {
        const rosDistro = maybeRosDistro;
        const isRos1 = ["melodic", "noetic"].includes(rosDistro);
        this.#profile = isRos1 ? "ros1" : "ros2";

        // Add common ROS message definitions
        const rosDataTypes = isRos1 ? CommonRosTypes.ros1 : ros2CommonDatatypes(rosDistro);

        const dataTypes: MessageDefinitionMap = new Map();
        for (const dataType in rosDataTypes) {
          const msgDef = (rosDataTypes as Record<string, MessageDefinition>)[dataType]!;
          dataTypes.set(dataType, msgDef);
        }
        this.#updateDataTypes(dataTypes);
      }

      if (event.capabilities.includes(ServerCapability.clientPublish)) {
        this.#playerCapabilities = this.#playerCapabilities.concat(PLAYER_CAPABILITIES.advertise);
        this.#setupPublishers();
      }
      if (event.capabilities.includes(ServerCapability.services)) {
        this.#serviceCallEncoding = event.supportedEncodings?.find((e) =>
          SUPPORTED_SERVICE_ENCODINGS.includes(e),
        );

        const alertId = "callService:unsupportedEncoding";
        if (this.#serviceCallEncoding) {
          this.#playerCapabilities = this.#playerCapabilities.concat(
            PLAYER_CAPABILITIES.callServices,
          );
          this.#alerts.removeAlert(alertId);
        } else {
          this.#alerts.addAlert(alertId, {
            severity: "warn",
            message: `Calling services is disabled as no compatible encoding could be found. \
            The server supports [${event.supportedEncodings?.join(", ")}], \
            but Studio only supports [${SUPPORTED_SERVICE_ENCODINGS.join(", ")}]`,
          });
        }
      }

      if (event.capabilities.includes(ServerCapability.parameters)) {
        this.#playerCapabilities = this.#playerCapabilities.concat(
          PLAYER_CAPABILITIES.getParameters,
          PLAYER_CAPABILITIES.setParameters,
        );

        // Periodically request all available parameters.
        this.#getParameterInterval = setInterval(() => {
          this.#client?.getParameters([], GET_ALL_PARAMS_REQUEST_ID);
        }, GET_ALL_PARAMS_PERIOD_MS);

        this.#client?.getParameters([], GET_ALL_PARAMS_REQUEST_ID);
      }

      if (event.capabilities.includes(ServerCapability.connectionGraph)) {
        this.#client?.subscribeConnectionGraph();
      }

      if (event.capabilities.includes(ServerCapability.assets)) {
        this.#playerCapabilities = this.#playerCapabilities.concat(PLAYER_CAPABILITIES.assets);
      }

      const { dataStartTime, dataEndTime } = event as PlaybackServerInfo;
      const wasControllingPlayback = this.#serverControlsPlayback;
      this.#dropPlaybackCapabilities();
      this.#serverControlsPlayback =
        event.capabilities.includes(PLAYBACK_CONTROL_CAPABILITY) &&
        dataStartTime != undefined &&
        dataEndTime != undefined &&
        compare(dataStartTime, dataEndTime) <= 0;
      if (this.#serverControlsPlayback) {
        this.#clearHistory();
        this.#startTime = dataStartTime;
        this.#endTime = dataEndTime;
        this.#clockTime ??= dataStartTime;
        this.#playerCapabilities = this.#playerCapabilities.concat(
          PLAYER_CAPABILITIES.playbackControl,
          PLAYER_CAPABILITIES.setSpeed,
        );
      } else {
        if (wasControllingPlayback) {
          this.#startTime = undefined;
          this.#endTime = undefined;
        }
        this.#playerCapabilities = this.#playerCapabilities.concat(
          PLAYER_CAPABILITIES.playbackControl,
          PLAYER_CAPABILITIES.setSpeed,
          PLAYER_CAPABILITIES.liveHistory,
        );
      }

      this.#emitState();
    });

    this.#client.on("status", (event) => {
      const msg = `FoxgloveWebSocket: ${event.message}`;
      if (event.level === StatusLevel.INFO) {
        log.info(msg);
      } else if (event.level === StatusLevel.WARNING) {
        log.warn(msg);
      } else {
        log.error(msg);
      }

      const alert: PlayerAlert = {
        message: event.message,
        severity: statusLevelToAlertSeverity(event.level),
      };

      if (event.message === "Send buffer limit reached") {
        alert.tip =
          "Server is dropping messages to the client. Check if you are subscribing to large or frequent topics or adjust your server send buffer limit.";
      }

      this.#alerts.addAlert(event.message, alert);
      this.#emitState();
    });

    this.#client.on("advertise", (newChannels) => {
      for (const channel of newChannels) {
        let parsedChannel;
        let schema;
        try {
          let schemaEncoding;
          let schemaData;
          if (
            channel.encoding === "json" &&
            (channel.schemaEncoding == undefined || channel.schemaEncoding === "jsonschema")
          ) {
            schemaEncoding = "jsonschema";
            schemaData = textEncoder.encode(channel.schema);
          } else if (
            channel.encoding === "protobuf" &&
            (channel.schemaEncoding == undefined || channel.schemaEncoding === "protobuf")
          ) {
            schemaEncoding = "protobuf";
            schemaData = Uint8Array.fromBase64(channel.schema);
          } else if (
            channel.encoding === "flatbuffer" &&
            (channel.schemaEncoding == undefined || channel.schemaEncoding === "flatbuffer")
          ) {
            schemaEncoding = "flatbuffer";
            schemaData = Uint8Array.fromBase64(channel.schema);
          } else if (
            channel.encoding === "ros1" &&
            (channel.schemaEncoding == undefined || channel.schemaEncoding === "ros1msg")
          ) {
            schemaEncoding = "ros1msg";
            schemaData = textEncoder.encode(channel.schema);
          } else if (
            channel.encoding === "cdr" &&
            (channel.schemaEncoding == undefined ||
              ["ros2idl", "ros2msg", "omgidl"].includes(channel.schemaEncoding))
          ) {
            schemaEncoding = channel.schemaEncoding ?? "ros2msg";
            schemaData = textEncoder.encode(channel.schema);
          } else {
            const msg = channel.schemaEncoding
              ? `Unsupported combination of message / schema encoding: (${channel.encoding} / ${channel.schemaEncoding})`
              : `Unsupported message encoding ${channel.encoding}`;
            throw new Error(msg);
          }
          schema = { name: channel.schemaName, encoding: schemaEncoding, data: schemaData };
          parsedChannel = parseChannel({ messageEncoding: channel.encoding, schema });
        } catch (error) {
          this.#unsupportedChannelIds.add(channel.id);
          this.#alerts.addAlert(`schema:${channel.topic}`, {
            severity: "error",
            message: `Failed to parse channel schema on ${channel.topic}`,
            error: toError(error),
          });
          this.#emitState();
          continue;
        }
        const existingChannel = this.#channelsByTopic.get(channel.topic);
        if (existingChannel && !_.isEqual(channel, existingChannel.channel)) {
          this.#alerts.addAlert(`duplicate-topic:${channel.topic}`, {
            severity: "error",
            message: `Multiple channels advertise the same topic: ${channel.topic} (${existingChannel.channel.id} and ${channel.id})`,
          });
          this.#emitState();
          continue;
        }
        const resolvedChannel = {
          channel,
          parsedChannel,
          record: { topic: channel.topic, messageEncoding: channel.encoding, schema },
        };
        this.#channelsById.set(channel.id, resolvedChannel);
        this.#channelsByTopic.set(channel.topic, resolvedChannel);
      }
      this.#updateTopicsAndDatatypes();
      this.#emitState();
      this.#processUnresolvedSubscriptions();
    });

    this.#client.on("unadvertise", (removedChannels) => {
      for (const id of removedChannels) {
        const chanInfo = this.#channelsById.get(id);
        if (!chanInfo) {
          if (!this.#unsupportedChannelIds.delete(id)) {
            this.#alerts.addAlert(`unadvertise:${id}`, {
              severity: "error",
              message: `Server unadvertised channel ${id} that was not advertised`,
            });
            this.#emitState();
          }
          continue;
        }
        for (const [subId, { channel }] of this.#resolvedSubscriptionsById) {
          if (channel.id === id) {
            this.#resolvedSubscriptionsById.delete(subId);
            this.#resolvedSubscriptionsByTopic.delete(channel.topic);
            this.#client?.unsubscribe(subId);
            this.#unresolvedSubscriptions.add(channel.topic);
          }
        }
        this.#channelsById.delete(id);
        this.#channelsByTopic.delete(chanInfo.channel.topic);
      }
      this.#updateTopicsAndDatatypes();
      this.#emitState();
    });

    this.#client.on("message", ({ subscriptionId, data }) => {
      const chanInfo = this.#resolvedSubscriptionsById.get(subscriptionId);
      if (!chanInfo) {
        const wasRecentlyCanceled = this.#recentlyCanceledSubscriptions.has(subscriptionId);
        if (!wasRecentlyCanceled) {
          this.#alerts.addAlert(`message-missing-subscription:${subscriptionId}`, {
            severity: "warn",
            message: `Received message on unknown subscription id: ${subscriptionId}. This might be a WebSocket server bug.`,
          });
          this.#emitState();
        }
        return;
      }

      try {
        this.#receivedBytes += data.byteLength;
        const receiveTime = this.#getCurrentTime();
        const topic = chanInfo.channel.topic;
        const deserializedMessage = chanInfo.parsedChannel.deserialize(data);

        // Lookup the size estimate for this topic or compute it if not found in the cache.
        let msgSizeEstimate = this.#messageSizeEstimateByTopic[topic];
        if (msgSizeEstimate == undefined) {
          msgSizeEstimate = estimateObjectSize(deserializedMessage);
          this.#messageSizeEstimateByTopic[topic] = msgSizeEstimate;
        }

        // The history also keeps the received bytes (for export and recording), so count both.
        const sizeInBytes = this.#serverControlsPlayback
          ? Math.max(data.byteLength, msgSizeEstimate)
          : msgSizeEstimate + data.byteLength;
        const msgEvent: MessageEvent = {
          topic,
          receiveTime,
          message: deserializedMessage,
          sizeInBytes,
          schemaName: chanInfo.channel.schemaName,
        };
        if (!this.#serverControlsPlayback) {
          this.#history.add(msgEvent);
          // ponytail: raw bytes aren't counted in the history memory limit; the heap guard covers it.
          const raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          this.#rawByMessage.set(msgEvent, { data: raw, channel: chanInfo });
          this.#recordingFor()?.record(chanInfo.record, receiveTime, raw);
        }
        // While reviewing history, new messages only go into the history.
        if (this.#historyCursor == undefined) {
          this.#parsedMessages.push(msgEvent);
        }

        // Update the message count for this topic
        let stats = this.#topicsStats.get(topic);
        if (!stats) {
          stats = { numMessages: 0 };
          this.#topicsStats.set(topic, stats);
        }
        stats.numMessages++;
        this.#topicsStatsChanged = true;
      } catch (error) {
        this.#alerts.addAlert(`message:${chanInfo.channel.topic}`, {
          severity: "error",
          message: `Failed to parse message on ${chanInfo.channel.topic}`,
          error: toError(error),
        });
      }
      this.#emitState();
    });

    this.#client.on("time", ({ timestamp }) => {
      if (!this.#serverPublishesTime) {
        return;
      }

      const time = fromNanoSec(timestamp);
      this.#lastClockWallMs = Date.now();
      if (this.#clockTime != undefined && isLessThan(time, this.#clockTime)) {
        this.#numTimeSeeks++;
        this.#parsedMessages.clear();
        // The clock was reset (e.g. a simulation or bag restarted): the history no longer fits.
        if (!this.#serverControlsPlayback) {
          this.#clearHistory();
          this.#startTime = undefined;
          if (!this.#isPlaying) {
            this.#historyCursor = time; // stay paused, at the new clock
          }
        }
      }

      // Override any previous start/end time when we set a clockTime for the first time which means
      // we've received the first "time" event and know the server controlled time.
      if (!this.#clockTime && !this.#serverControlsPlayback) {
        this.#startTime = time;
        this.#endTime = time;
      }

      this.#clockTime = time;
      this.#emitState();
    });

    this.#client.on("parameterValues", ({ parameters, id }) => {
      const mappedParameters = parameters.map((param) => {
        return param.type === "byte_array"
          ? {
              ...param,
              value: Uint8Array.fromBase64(param.value as string),
            }
          : param;
      });
      const parameterTypes = parameters.map((p) => [p.name, p.type] as [string, Parameter["type"]]);
      const parameterTypesMap = new Map<string, Parameter["type"]>(parameterTypes);

      const newParameters = mappedParameters.filter((param) => !this.#parameters.has(param.name));

      if (id === GET_ALL_PARAMS_REQUEST_ID) {
        // Reset params
        this.#parameters = new Map(mappedParameters.map((param) => [param.name, param.value]));
        this.#parameterTypeByName = parameterTypesMap;
      } else {
        // Update params
        const updatedParameters = new Map(this.#parameters);
        mappedParameters.forEach((param) => updatedParameters.set(param.name, param.value));
        this.#parameters = updatedParameters;
        for (const [paramName, paramType] of parameterTypesMap) {
          this.#parameterTypeByName.set(paramName, paramType);
        }
      }

      this.#emitState();

      if (
        newParameters.length > 0 &&
        this.#serverCapabilities.includes(ServerCapability.parametersSubscribe)
      ) {
        // Subscribe to value updates of new parameters
        this.#client?.subscribeParameterUpdates(newParameters.map((p) => p.name));
      }
    });

    this.#client.on("advertiseServices", (services) => {
      if (!this.#serviceCallEncoding) {
        return;
      }

      let defaultSchemaEncoding = "";
      if (this.#serviceCallEncoding === "json") {
        defaultSchemaEncoding = "jsonschema";
      } else if (this.#serviceCallEncoding === "ros1") {
        defaultSchemaEncoding = "ros1msg";
      } else if (this.#serviceCallEncoding === "cdr") {
        defaultSchemaEncoding = "ros2msg";
      }

      const serviceTypes = new Map(this.#serviceTypes);
      for (const service of services) {
        const serviceAlertId = `service:${service.id}`;
        // If not explicitly given, derive request / response type name from the service type
        // (according to ROS convention).
        const requestType = service.request?.schemaName ?? `${service.type}_Request`;
        const responseType = service.response?.schemaName ?? `${service.type}_Response`;
        const requestMsgEncoding = service.request?.encoding ?? this.#serviceCallEncoding;
        const responseMsgEncoding = service.response?.encoding ?? this.#serviceCallEncoding;

        // Note: The `requestSchema` and `responseSchema` fields are deprecated in @foxglove/ws-protocol.
        // However, they are still required for compatibility with Foxglove Bridge.
        // We are temporarily reintroducing support for these fields to avoid blocking users.
        // This usage should be removed once Foxglove Bridge transitions away from these deprecated fields.
        try {
          if (
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            (service.request == undefined && service.requestSchema == undefined) ||
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            (service.response == undefined && service.responseSchema == undefined)
          ) {
            throw new Error("Invalid service definition, at least one required field is missing");
          } else if (
            !defaultSchemaEncoding &&
            (service.request == undefined || service.response == undefined)
          ) {
            throw new Error("Cannot determine service request or response schema encoding");
          } else if (!SUPPORTED_SERVICE_ENCODINGS.includes(requestMsgEncoding)) {
            const supportedEncodingsStr = SUPPORTED_SERVICE_ENCODINGS.join(", ");
            throw new Error(
              `Unsupported service request message encoding. ${requestMsgEncoding} not in list of supported encodings [${supportedEncodingsStr}]`,
            );
          }

          const parseChannelOptions = { allowEmptySchema: true };
          const parsedRequest = parseChannel(
            {
              messageEncoding: requestMsgEncoding,
              schema: {
                name: requestType,
                encoding: service.request?.schemaEncoding ?? defaultSchemaEncoding,
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                data: textEncoder.encode(service.request?.schema ?? service.requestSchema),
              },
            },
            parseChannelOptions,
          );
          const parsedResponse = parseChannel(
            {
              messageEncoding: responseMsgEncoding,
              schema: {
                name: responseType,
                encoding: service.response?.schemaEncoding ?? defaultSchemaEncoding,
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                data: textEncoder.encode(service.response?.schema ?? service.responseSchema),
              },
            },
            parseChannelOptions,
          );
          const requestMsgDef = rosDatatypesToMessageDefinition(
            parsedRequest.datatypes,
            requestType,
          );
          let requestMessageWriter: MessageWriter | undefined;
          if (requestMsgEncoding === "ros1") {
            requestMessageWriter = new Ros1MessageWriter(requestMsgDef);
          } else if (requestMsgEncoding === "cdr") {
            requestMessageWriter = new Ros2MessageWriter(requestMsgDef);
          } else if (requestMsgEncoding === "json") {
            requestMessageWriter = new JsonMessageWriter();
          }
          if (!requestMessageWriter) {
            // Should never go here as we sanity-checked the encoding already above
            throw new Error(`Unsupported service request message encoding ${requestMsgEncoding}`);
          }

          // Add type definitions for service response and request
          this.#updateDataTypes(parsedRequest.datatypes);
          this.#updateDataTypes(parsedResponse.datatypes);

          const resolvedService: ResolvedService = {
            service,
            parsedResponse,
            requestMessageWriter,
          };
          this.#servicesByName.set(service.name, resolvedService);
          serviceTypes.set(service.name, {
            type: service.type,
            requestSchemaName: requestType,
            responseSchemaName: responseType,
          });
          this.#alerts.removeAlert(serviceAlertId);

          // Issue a warning to users if the service relies on deprecated fields (`requestSchema` or `responseSchema`).
          // This highlights the need for migration, as these fields will be removed in future versions.

          // eslint-disable-next-line @typescript-eslint/no-deprecated
          if (service.requestSchema || service.responseSchema) {
            this.#alerts.addAlert(serviceAlertId, {
              severity: "warn",
              message: `Service ${service.name}`,
              error: new Error(
                "requestSchema and responseSchema are deprecated and will not be supported in future versions of Lichtblick",
              ),
            });
          }
        } catch (error) {
          this.#alerts.addAlert(serviceAlertId, {
            severity: "error",
            message: `Failed to parse service ${service.name}`,
            error: toError(error),
          });
        }
      }
      this.#serviceTypes = serviceTypes;
      this.#emitState();
    });

    this.#client.on("unadvertiseServices", (serviceIds) => {
      let needsStateUpdate = false;
      for (const serviceId of serviceIds) {
        const service = [...this.#servicesByName.values()].find(
          (srv) => srv.service.id === serviceId,
        );
        if (service) {
          this.#servicesByName.delete(service.service.name);
          this.#serviceTypes = new Map(this.#serviceTypes);
          this.#serviceTypes.delete(service.service.name);
          needsStateUpdate = true;
        }
        const serviceAlertId = `service:${serviceId}`;
        needsStateUpdate = this.#alerts.removeAlert(serviceAlertId) || needsStateUpdate;
      }
      if (needsStateUpdate) {
        this.#emitState();
      }
    });

    this.#client.on("serviceCallResponse", (response) => {
      const responseCallback = this.#serviceResponseCbs.get(response.callId);
      if (!responseCallback) {
        this.#alerts.addAlert(`callService:${response.callId}`, {
          severity: "error",
          message: `Received a response for a service for which no callback was registered`,
        });
        return;
      }
      responseCallback(response);
      this.#serviceResponseCbs.delete(response.callId);
    });

    this.#client.on("connectionGraphUpdate", (event) => {
      if (event.publishedTopics.length > 0 || event.removedTopics.length > 0) {
        const newMap = new Map<string, Set<string>>(this.#publishedTopics ?? new Map());
        for (const { name, publisherIds } of event.publishedTopics) {
          newMap.set(name, new Set(publisherIds));
        }
        event.removedTopics.forEach((topic) => newMap.delete(topic));
        this.#publishedTopics = newMap;
      }
      if (event.subscribedTopics.length > 0 || event.removedTopics.length > 0) {
        const newMap = new Map<string, Set<string>>(this.#subscribedTopics ?? new Map());
        for (const { name, subscriberIds } of event.subscribedTopics) {
          newMap.set(name, new Set(subscriberIds));
        }
        event.removedTopics.forEach((topic) => newMap.delete(topic));
        this.#subscribedTopics = newMap;
      }
      if (event.advertisedServices.length > 0 || event.removedServices.length > 0) {
        const newMap = new Map<string, Set<string>>(this.#advertisedServices ?? new Map());
        for (const { name, providerIds } of event.advertisedServices) {
          newMap.set(name, new Set(providerIds));
        }
        event.removedServices.forEach((service) => newMap.delete(service));
        this.#advertisedServices = newMap;
      }

      this.#emitState();
    });

    this.#client.on("fetchAssetResponse", (response) => {
      const responseCallback = this.#fetchAssetRequests.get(response.requestId);
      if (!responseCallback) {
        throw Error(
          `Received a response for a fetch asset request for which no callback was registered`,
        );
      }
      responseCallback(response);
      this.#serviceResponseCbs.delete(response.requestId);
    });
  };

  #updateTopicsAndDatatypes() {
    // Build a new topics array from this._channelsById
    const topics: Topic[] = Array.from(this.#channelsById.values(), (chanInfo) => ({
      name: chanInfo.channel.topic,
      schemaName: chanInfo.channel.schemaName,
    }));

    // Remove stats entries for removed topics
    const topicsSet = new Set<string>(topics.map((topic) => topic.name));
    for (const topic of this.#topicsStats.keys()) {
      if (!topicsSet.has(topic)) {
        this.#topicsStats.delete(topic);
        this.#topicsStatsChanged = true;
      }
    }

    this.#topics = topics;

    // Update the _datatypes map;
    for (const { parsedChannel } of this.#channelsById.values()) {
      this.#updateDataTypes(parsedChannel.datatypes);
    }

    this.#emitState();
  }

  // Potentially performance-sensitive; await can be expensive
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  #emitState = debouncePromise(() => {
    if (!this.#listener || this.#closed) {
      return Promise.resolve();
    }

    if (!this.#topics) {
      return this.#listener({
        name: this.#name,
        presence: this.#presence,
        progress: {},
        capabilities: this.#playerCapabilities,
        profile: undefined,
        playerId: this.#id,
        activeData: undefined,
        alerts: this.#alerts.alerts(),
        urlState: this.#urlState,
      });
    }

    let currentTime = this.#getCurrentTime();
    if (!this.#serverControlsPlayback) {
      const latest = currentTime;
      this.#checkHeap();
      if (this.#clockTime != undefined) {
        this.#history.trim(latest);
      }
      this.#startTime = this.#history.startTime(latest);
      this.#endTime = latest;
      currentTime = this.#historyCursor ?? latest;
      this.#updateHistoryAlerts();
    }

    const messages = this.#parsedMessages.drain();
    const newest = messages.at(-1);
    if (
      newest != undefined &&
      (this.#lastDelivered == undefined ||
        compare(newest.receiveTime, this.#lastDelivered.receiveTime) >= 0)
    ) {
      this.#lastDelivered = newest;
    }
    // Hand out a new Map only when stats changed, so consumers can compare by reference
    if (this.#topicsStatsChanged) {
      this.#topicsStatsChanged = false;
      this.#emittedTopicsStats = new Map(this.#topicsStats);
    }
    return this.#listener({
      name: this.#name,
      presence: this.#presence,
      progress: {},
      capabilities: this.#playerCapabilities,
      profile: this.#profile,
      playerId: this.#id,
      alerts: this.#alerts.alerts(),
      urlState: this.#urlState,

      activeData: {
        messages,
        totalBytesReceived: this.#receivedBytes,
        startTime: this.#startTime ?? currentTime,
        endTime: this.#endTime ?? currentTime,
        currentTime,
        isPlaying: this.#isPlaying,
        speed: this.#speed,
        lastSeekTime: this.#numTimeSeeks,
        topics: this.#topics,
        topicStats: this.#emittedTopicsStats,
        datatypes: this.#datatypes,
        parameters: this.#parameters,
        publishedTopics: this.#publishedTopics,
        subscribedTopics: this.#subscribedTopics,
        services: this.#advertisedServices,
        serviceTypes: this.#serviceTypes,
        liveStats: this.#serverControlsPlayback
          ? undefined
          : {
              connectedAtMs: this.#connectedAtMs,
              historyMessages: this.#history.size(),
              historyBytes: this.#history.sizeBytes(),
              historyLimitBytes: this.#history.maxBytes(),
            },
      },
    });
  });

  public setListener(listener: (arg0: PlayerState) => Promise<void>): void {
    this.#listener = listener;
    this.#emitState();
  }

  public close(): void {
    this.#closed = true;
    this.#stopRecording();
    this.#unsubscribeHistorySettings();
    this.#clearHistory();
    this.#client?.close();
    if (this.#openTimeout != undefined) {
      clearTimeout(this.#openTimeout);
      this.#openTimeout = undefined;
    }
    if (this.#getParameterInterval != undefined) {
      clearInterval(this.#getParameterInterval);
      this.#getParameterInterval = undefined;
    }
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    const newTopics = new Set(subscriptions.map(({ topic }) => topic));

    if (!this.#client || this.#closed) {
      // Remember requested subscriptions so we can retry subscribing when
      // the client is available.
      this.#unresolvedSubscriptions = newTopics;
      return;
    }

    for (const topic of newTopics) {
      if (!this.#resolvedSubscriptionsByTopic.has(topic)) {
        this.#unresolvedSubscriptions.add(topic);
      }
    }

    for (const [topic, subId] of this.#resolvedSubscriptionsByTopic) {
      if (!newTopics.has(topic)) {
        this.#client.unsubscribe(subId);
        this.#resolvedSubscriptionsByTopic.delete(topic);
        this.#resolvedSubscriptionsById.delete(subId);
        this.#recentlyCanceledSubscriptions.add(subId);

        // Reset the message count for this topic
        if (this.#topicsStats.delete(topic)) {
          this.#topicsStatsChanged = true;
        }

        setTimeout(
          () => this.#recentlyCanceledSubscriptions.delete(subId),
          SUBSCRIPTION_WARNING_SUPPRESSION_MS,
        );
      }
    }

    for (const topic of this.#unresolvedSubscriptions) {
      if (!newTopics.has(topic)) {
        this.#unresolvedSubscriptions.delete(topic);
      }
    }

    this.#processUnresolvedSubscriptions();
  }

  #processUnresolvedSubscriptions() {
    if (!this.#client) {
      return;
    }

    for (const topic of this.#unresolvedSubscriptions) {
      const chanInfo = this.#channelsByTopic.get(topic);
      if (chanInfo) {
        const subId = this.#client.subscribe(chanInfo.channel.id);
        this.#unresolvedSubscriptions.delete(topic);
        this.#resolvedSubscriptionsByTopic.set(topic, subId);
        this.#resolvedSubscriptionsById.set(subId, chanInfo);
      }
    }
  }

  public setPublishers(publishers: AdvertiseOptions[]): void {
    // Filter out duplicates.
    const uniquePublications = _.uniqWith(publishers, _.isEqual);

    // Save publications and return early if we are not connected or the advertise capability is missing.
    if (
      !this.#client ||
      this.#closed ||
      !this.#playerCapabilities.includes(PLAYER_CAPABILITIES.advertise)
    ) {
      this.#unresolvedPublications = uniquePublications;
      return;
    }

    // Determine new & removed publications.
    const currentPublications = Array.from(this.#publicationsByTopic.values());
    const removedPublications = currentPublications.filter((channel) => {
      return (
        uniquePublications.find(
          ({ topic, schemaName }) => channel.topic === topic && channel.schemaName === schemaName,
        ) == undefined
      );
    });
    const newPublications = uniquePublications.filter(({ topic, schemaName }) => {
      return (
        currentPublications.find(
          (publication) => publication.topic === topic && publication.schemaName === schemaName,
        ) == undefined
      );
    });

    // Unadvertise removed channels.
    for (const channel of removedPublications) {
      this.#unadvertiseChannel(channel);
    }

    // Advertise new channels.
    for (const publication of newPublications) {
      this.#advertiseChannel(publication);
    }

    if (removedPublications.length > 0 || newPublications.length > 0) {
      this.#emitState();
    }
  }

  public setParameter(key: string, value: ParameterValue): void {
    if (!this.#client) {
      throw new Error(`Attempted to set parameters without a valid Foxglove WebSocket connection`);
    }

    log.debug(`FoxgloveWebSocketPlayer.setParameter(key=${key}, value=${JSON.stringify(value)})`);
    const isByteArray = value instanceof Uint8Array;
    const paramValueToSent = isByteArray ? value.toBase64() : value;
    this.#client.setParameters(
      [
        {
          name: key,
          value: paramValueToSent as Parameter["value"],
          type: isByteArray ? "byte_array" : this.#parameterTypeByName.get(key),
        },
      ],
      randomUUID(),
    );

    // Pre-actively update our parameter map, such that a change is detected if our update failed
    this.#parameters.set(key, value);
    this.#emitState();
  }

  public publish({ topic, msg }: PublishPayload): void {
    if (!this.#client) {
      throw new Error(`Attempted to publish without a valid Foxglove WebSocket connection`);
    }

    const clientChannel = this.#publicationsByTopic.get(topic);
    if (!clientChannel) {
      throw new Error(`Tried to publish on topic '${topic}' that has not been advertised before.`);
    }

    if (clientChannel.encoding === "json") {
      // Ensure that typed arrays are encoded as arrays and not objects.
      const replacer = (_key: string, value: unknown) => {
        return ArrayBuffer.isView(value)
          ? Array.from(value as unknown as ArrayLike<unknown>)
          : value;
      };
      const message = new TextEncoder().encode(JSON.stringify(msg, replacer) ?? "");
      this.#client.sendMessage(clientChannel.id, message);
    } else if (
      ROS_ENCODINGS.includes(clientChannel.encoding) &&
      clientChannel.messageWriter != undefined
    ) {
      const message = clientChannel.messageWriter.writeMessage(msg);
      this.#client.sendMessage(clientChannel.id, message);
    }
  }

  public async callService(serviceName: string, request: unknown): Promise<unknown> {
    if (!this.#client) {
      throw new Error(
        `Attempted to call service ${serviceName} without a valid Foxglove WebSocket connection.`,
      );
    }

    if (request == undefined || typeof request !== "object") {
      throw new Error("FoxgloveWebSocketPlayer#callService request must be an object.");
    }

    const resolvedService = this.#servicesByName.get(serviceName);
    if (!resolvedService) {
      throw new Error(
        `Tried to call service '${serviceName}' that has not been advertised before.`,
      );
    }

    const { service, parsedResponse, requestMessageWriter } = resolvedService;

    const requestMsgEncoding = service.request?.encoding ?? this.#serviceCallEncoding!;
    const serviceCallRequest: ServiceCallPayload = {
      serviceId: service.id,
      callId: ++this.#nextServiceCallId,
      encoding: requestMsgEncoding,
      data: new DataView(new Uint8Array().buffer),
    };

    const message = requestMessageWriter.writeMessage(request);
    serviceCallRequest.data = new DataView(message.buffer);
    this.#client.sendServiceCallRequest(serviceCallRequest);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.#serviceResponseCbs.set(serviceCallRequest.callId, (response: ServiceCallResponse) => {
        try {
          const data = parsedResponse.deserialize(response.data);
          resolve(data as Record<string, unknown>);
        } catch (error: unknown) {
          reject(toError(error));
        }
      });
    });
  }

  public async fetchAsset(uri: string): Promise<Asset> {
    if (!this.#client) {
      throw new Error(
        `Attempted to fetch assset ${uri} without a valid Foxglove WebSocket connection.`,
      );
    } else if (!this.#serverCapabilities.includes(ServerCapability.assets)) {
      throw new Error(`Fetching assets (${uri}) is not supported for FoxgloveWebSocketPlayer`);
    }

    let promise = this.#fetchedAssets.get(uri);
    if (promise) {
      return await promise;
    }

    promise = new Promise<Asset>((resolve, reject) => {
      const fetchedAsset = this.#fetchedAssets.get(uri);
      if (fetchedAsset) {
        resolve(fetchedAsset);
        return;
      }

      const assetRequestId = ++this.#nextAssetRequestId;
      this.#fetchAssetRequests.set(assetRequestId, (response) => {
        if (response.status === FetchAssetStatus.SUCCESS) {
          const newAsset: Asset = {
            uri,
            data: new Uint8Array(
              response.data.buffer,
              response.data.byteOffset,
              response.data.byteLength,
            ),
          };
          resolve(newAsset);
        } else {
          reject(new Error(`Failed to fetch asset: ${response.error}`));
        }
      });
      this.#client?.fetchAsset(uri, assetRequestId);
    });

    this.#fetchedAssets.set(uri, promise);
    return await promise;
  }

  public startPlayback(): void {
    this.#isPlaying = true;
    if (this.#serverControlsPlayback) {
      this.#sendPlaybackControl();
      return;
    }
    const cursor = this.#historyCursor;
    if (cursor != undefined && compare(cursor, this.#getCurrentTime()) >= 0) {
      this.#historyCursor = undefined; // at the newest data: live again
    } else {
      this.#scheduleHistoryTick();
    }
    this.#emitState();
  }

  public pausePlayback(): void {
    this.#isPlaying = false;
    if (this.#serverControlsPlayback) {
      this.#sendPlaybackControl();
      return;
    }
    this.#historyCursor ??= this.#getCurrentTime();
    this.#stopHistoryTick();
    this.#emitState();
  }

  public setPlaybackSpeed(speed: number): void {
    this.#speed = speed;
    if (this.#serverControlsPlayback) {
      this.#sendPlaybackControl();
      return;
    }
    this.#emitState();
  }

  public seekPlayback(time: Time): void {
    const seekTimeNs = toNanoSec(time);
    if (seekTimeNs < 0n) {
      return;
    }
    if (this.#serverControlsPlayback) {
      this.#sendPlaybackControl(seekTimeNs);
      return;
    }
    this.#seekHistory(time);
  }

  /** Jump to `time` inside the history, giving panels the state at that time. */
  #seekHistory(time: Time): void {
    const latest = this.#getCurrentTime();
    const start = this.#history.startTime(latest);
    const target = isLessThan(time, start) ? start : isGreaterThan(time, latest) ? latest : time;
    this.#numTimeSeeks++;
    this.#parsedMessages.clear();
    const topics = new Set(this.#resolvedSubscriptionsByTopic.keys());
    const backfill = this.#history.backfill(target, topics);
    // Seeking past what panels have seen (e.g. Live after a pause): also hand them the messages
    // that arrived meanwhile, so accumulating panels (plots, logs) have no gap.
    const delivered = this.#lastDelivered;
    const missed =
      delivered != undefined && compare(delivered.receiveTime, target) <= 0
        ? this.#history.rangeAfter(delivered, target).filter((msg) => topics.has(msg.topic))
        : [];
    if (missed.length === 0) {
      this.#queueMessages(backfill);
    } else {
      // Backfill-only messages were received before every missed one, so with a stable sort
      // messages at the same time keep their arrival order.
      const missedSet = new Set(missed);
      this.#queueMessages(
        [...backfill.filter((msg) => !missedSet.has(msg)), ...missed].sort((a, b) =>
          compare(a.receiveTime, b.receiveTime),
        ),
      );
    }
    this.#historyCursor = target;
    if (this.#isPlaying) {
      this.#scheduleHistoryTick();
    }
    this.#emitState();
  }

  #queueMessages(messages: readonly MessageEvent[]): void {
    for (const msg of messages) {
      this.#parsedMessages.push(msg);
    }
  }

  #scheduleHistoryTick(): void {
    if (this.#historyTimer != undefined || this.#historyCursor == undefined) {
      return;
    }
    this.#historyTickMs = performance.now();
    this.#historyTimer = setTimeout(this.#historyTick, HISTORY_TICK_MS);
  }

  #stopHistoryTick(): void {
    clearTimeout(this.#historyTimer);
    this.#historyTimer = undefined;
  }

  /** Advance the history cursor by the elapsed time times speed; go live on reaching the newest data. */
  #historyTick = (): void => {
    this.#historyTimer = undefined;
    const cursor = this.#historyCursor;
    if (this.#closed || !this.#isPlaying || cursor == undefined) {
      return;
    }
    const nowMs = performance.now();
    const latest = this.#getCurrentTime();
    if (isLessThan(cursor, this.#history.startTime(latest))) {
      // Played slower than the history expires: continue from the oldest kept data.
      this.#seekHistory(cursor);
      return;
    }
    const next = fromNanoSec(
      toNanoSec(cursor) + BigInt(Math.round((nowMs - this.#historyTickMs) * 1e6 * this.#speed)),
    );
    if (compare(next, latest) >= 0) {
      this.#queueMessages(this.#history.range(cursor, latest));
      this.#historyCursor = undefined;
    } else {
      this.#queueMessages(this.#history.range(cursor, next));
      this.#historyCursor = next;
      this.#scheduleHistoryTick();
    }
    this.#emitState();
  };

  /** The recorder for this connection, started on first use while recording is on. */
  #recordingFor(): LiveRecorder | undefined {
    if (
      !this.#recorder &&
      !this.#recorderUnavailable &&
      liveHistorySettings.getState().diskMiB > 0 &&
      supportsLiveRecording() &&
      typeof Worker !== "undefined"
    ) {
      const onError = (error: unknown) => {
        this.#alerts.addAlert("liveRecording:failed", {
          severity: "warn",
          message: "Recording to browser storage stopped",
          tip: "The connection and its history in memory are unaffected. Free up disk space or lower the recording budget in Settings.",
          error: toError(error),
        });
        this.#emitState();
      };
      try {
        this.#recorder = new LiveRecorder({
          profile: this.#profile,
          source: { url: this.#url, serverName: this.#serverName },
          onError,
        });
      } catch (error) {
        this.#recorderUnavailable = true;
        onError(error);
      }
    }
    return this.#recorder;
  }

  #stopRecording(): void {
    const recorder = this.#recorder;
    this.#recorder = undefined;
    void recorder?.stop().catch((error: unknown) => {
      log.error("Failed to finish the live recording", error);
    });
  }

  /** Write everything in the live history to an MCAP file. */
  public async exportLiveHistory(writable: IWritable): Promise<void> {
    const messages = this.#history.snapshot();
    const writer = new McapWriter({ writable });
    await writer.start({ profile: this.#profile ?? "", library: "Lichtblick live history" });
    const schemaIds = new Map<string, number>();
    const channelIds = new Map<ResolvedChannel, number>();
    let sequence = 0;
    for (const msg of messages) {
      const raw = this.#rawByMessage.get(msg);
      if (!raw) {
        continue;
      }
      let channelId = channelIds.get(raw.channel);
      if (channelId == undefined) {
        const { channel, record } = raw.channel;
        const schemaKey = `${record.schema.encoding}\0${record.schema.name}\0${channel.schema}`;
        let schemaId = schemaIds.get(schemaKey);
        if (schemaId == undefined) {
          schemaId = await writer.registerSchema(record.schema);
          schemaIds.set(schemaKey, schemaId);
        }
        channelId = await writer.registerChannel({
          topic: record.topic,
          messageEncoding: record.messageEncoding,
          schemaId,
          metadata: new Map(),
        });
        channelIds.set(raw.channel, channelId);
      }
      const time = toNanoSec(msg.receiveTime);
      await writer.addMessage({
        channelId,
        sequence: sequence++,
        logTime: time,
        publishTime: time,
        data: raw.data,
      });
    }
    await writer.end();
  }

  /** Give history memory back while the browser heap is nearly full, before the tab crashes. */
  #checkHeap(): void {
    const nowMs = Date.now();
    if (nowMs - this.#lastHeapCheckMs < HEAP_CHECK_MS) {
      return;
    }
    this.#lastHeapCheckMs = nowMs;
    this.#heapLimitBytes = heapLimitBytes(
      readHeapUsage(),
      this.#history.sizeBytes(),
      this.#heapLimitBytes,
    );
    this.#applyHistoryMemoryLimit();
  }

  #applyHistoryMemoryLimit(): void {
    this.#history.setMaxBytes(
      Math.min(liveHistorySettings.getState().maxMiB * MIB, this.#heapLimitBytes ?? Infinity),
    );
  }

  #clearHistory(): void {
    this.#history.clear();
    this.#stopHistoryTick();
    this.#historyCursor = undefined;
    this.#lastDelivered = undefined;
  }

  #setAlert(id: string, alert: PlayerAlert | undefined): void {
    if (!alert) {
      this.#alerts.removeAlert(id);
      return;
    }
    const existing = this.#alerts.getAlert(id);
    if (existing?.message !== alert.message || existing.severity !== alert.severity) {
      this.#alerts.addAlert(id, alert);
    }
  }

  #updateHistoryAlerts(): void {
    const reviewing = this.#historyCursor != undefined;
    this.#setAlert(
      "liveHistory:no-clock",
      this.#serverPublishesTime
        ? undefined
        : {
            severity: reviewing ? "warn" : "info",
            message: "No server clock: history uses local receive time",
            tip: "The server doesn't publish time, so messages are placed on the timeline by when they arrive here. Publish a clock on the server (e.g. use_sim_time) for exact timing.",
          },
    );
    const clockAgeMs = Date.now() - this.#lastClockWallMs;
    this.#setAlert(
      "liveHistory:stale-clock",
      this.#serverPublishesTime &&
        this.#presence === PlayerPresence.PRESENT &&
        clockAgeMs > CLOCK_STALE_MS
        ? {
            severity: "warn",
            message:
              this.#clockTime == undefined
                ? "Waiting for the server clock"
                : `Server clock stale: no time update for ${Math.floor(clockAgeMs / 1000)} s`,
            tip: "Messages keep arriving but the server's time doesn't advance, so they pile up at one point on the timeline.",
          }
        : undefined,
    );
    const windowSec = Number(this.#history.windowNs()) / 1e9;
    const limitMiB = Math.round(this.#history.maxBytes() / MIB);
    const heapLimited = this.#heapLimitBytes != undefined;
    this.#setAlert(
      "liveHistory:memory-cap",
      this.#history.capLimited()
        ? {
            severity: "warn",
            message: heapLimited
              ? `History shorter than ${windowSec} s: browser memory nearly full, history limited to ${formatLiveHistoryMemory(limitMiB)}`
              : `History shorter than ${windowSec} s: memory limit of ${formatLiveHistoryMemory(limitMiB)} reached`,
            tip: heapLimited
              ? "The browser tab is close to running out of memory, so the history gives memory back. Close other heavy panels or tabs, or shorten the history."
              : "The oldest messages are dropped early. Raise the memory limit in Settings, subscribe to fewer or smaller topics, or shorten the history.",
          }
        : undefined,
    );
    const cursor = this.#historyCursor;
    this.#setAlert(
      "liveHistory:expired",
      cursor != undefined && isLessThan(cursor, this.#startTime ?? cursor)
        ? {
            severity: "warn",
            message: "Paused position is no longer in the history",
            tip: "Panels still show the paused state. Play or seek to continue from the oldest kept data, or press Live.",
          }
        : undefined,
    );
  }

  public setGlobalVariables(): void {}

  public getBatchIterator(): undefined {
    // FoxgloveWebSocketPlayer does not support batch iteration
    return undefined;
  }

  // Return the current time
  //
  // For servers which publish a clock, we return that time. If the server disconnects we continue
  // to return the last known time. For servers which do not publish a clock, we use wall time.
  #getCurrentTime(): Time {
    // If the server does not publish the time, then we set the clock time to realtime as long as
    // the server is connected. When the server is not connected, time stops.
    if (!this.#serverPublishesTime && !this.#serverControlsPlayback) {
      this.#clockTime =
        this.#presence === PlayerPresence.PRESENT ? fromMillis(Date.now()) : this.#clockTime;
    }

    return this.#clockTime ?? ZERO_TIME;
  }

  #setupPublishers(): void {
    // This function will be called again once a connection is established
    if (!this.#client || this.#closed) {
      return;
    }

    if (this.#unresolvedPublications.length === 0) {
      return;
    }

    this.#alerts.removeAlerts((id) => id.startsWith("pub:"));

    for (const publication of this.#unresolvedPublications) {
      this.#advertiseChannel(publication);
    }

    this.#unresolvedPublications = [];
    this.#emitState();
  }

  #advertiseChannel(publication: AdvertiseOptions) {
    if (!this.#client) {
      return;
    }

    const encoding = this.#supportedEncodings
      ? this.#supportedEncodings.find((e) => SUPPORTED_PUBLICATION_ENCODINGS.includes(e))
      : FALLBACK_PUBLICATION_ENCODING;

    const { topic, schemaName, options } = publication;

    const encodingAlertId = `pub:encoding:${topic}`;
    const msgdefAlertId = `pub:msgdef:${topic}`;

    if (!encoding) {
      this.#alerts.addAlert(encodingAlertId, {
        severity: "warn",
        message: `Cannot advertise topic '${topic}': Server does not support one of the following encodings for client-side publishing: ${SUPPORTED_PUBLICATION_ENCODINGS}`,
      });
      return;
    }

    let messageWriter: Publication["messageWriter"] = undefined;
    if (ROS_ENCODINGS.includes(encoding)) {
      // Try to retrieve the ROS message definition for this topic
      let msgdef: MessageDefinition[];
      try {
        const datatypes =
          (options?.["datatypes"] as MessageDefinitionMap | undefined) ?? this.#datatypes;
        if (!(datatypes instanceof Map)) {
          throw new Error("Datatypes option must be a map");
        }
        msgdef = rosDatatypesToMessageDefinition(datatypes, schemaName);
      } catch (error) {
        log.debug(error);
        this.#alerts.addAlert(msgdefAlertId, {
          severity: "warn",
          message: `Unknown message definition for "${topic}"`,
          tip: `Try subscribing to the topic "${topic}" before publishing to it`,
        });
        return;
      }

      messageWriter =
        encoding === "ros1" ? new Ros1MessageWriter(msgdef) : new Ros2MessageWriter(msgdef);
    }

    const channelId = this.#client.advertise({ topic, encoding, schemaName });
    this.#publicationsByTopic.set(topic, {
      id: channelId,
      topic,
      encoding,
      schemaName,
      messageWriter,
    });

    for (const alertId of [encodingAlertId, msgdefAlertId]) {
      if (this.#alerts.hasAlert(alertId)) {
        this.#alerts.removeAlert(alertId);
      }
    }
  }

  #unadvertiseChannel(channel: Publication) {
    if (!this.#client) {
      return;
    }

    this.#client.unadvertise(channel.id);
    this.#publicationsByTopic.delete(channel.topic);
    const alertIds = [`pub:encoding:${channel.topic}`, `pub:msgdef:${channel.topic}`];
    for (const alertId of alertIds) {
      if (this.#alerts.hasAlert(alertId)) {
        this.#alerts.removeAlert(alertId);
      }
    }
  }

  #sendPlaybackControl(seekTimeNs?: bigint): void {
    if (!this.#serverControlsPlayback || !this.#client) {
      return;
    }
    this.#ws?.send(
      encodePlaybackControlRequest({
        play: this.#isPlaying,
        speed: this.#speed,
        seekTimeNs,
        requestId: randomUUID(),
      }),
    );
    this.#emitState();
  }

  #handlePlaybackState(state: PlaybackState): void {
    if (state.didSeek) {
      this.#numTimeSeeks++;
      this.#parsedMessages.clear();
    }
    this.#clockTime = fromNanoSec(state.currentTimeNs);
    this.#isPlaying = state.status === PlaybackStatus.Playing;
    if (Number.isFinite(state.speed)) {
      this.#speed = state.speed;
    }
    this.#emitState();
  }

  #dropPlaybackCapabilities(): void {
    this.#playerCapabilities = this.#playerCapabilities.filter(
      (cap) =>
        cap !== PLAYER_CAPABILITIES.playbackControl &&
        cap !== PLAYER_CAPABILITIES.setSpeed &&
        cap !== PLAYER_CAPABILITIES.liveHistory,
    );
  }

  #resetSessionState(): void {
    this.#startTime = undefined;
    this.#endTime = undefined;
    this.#clockTime = undefined;
    this.#serverControlsPlayback = false;
    this.#dropPlaybackCapabilities();
    this.#isPlaying = true;
    this.#speed = 1;
    this.#topicsStats = new Map();
    this.#topicsStatsChanged = true;
    this.#parsedMessages.clear();
    this.#receivedBytes = 0;
    this.#clearHistory();
    this.#lastClockWallMs = Date.now();
    this.#alerts.clear();
    this.#parameters = new Map();
    this.#fetchedAssets.clear();
    for (const [requestId, callback] of this.#fetchAssetRequests) {
      callback({
        op: BinaryOpcode.FETCH_ASSET_RESPONSE,
        status: FetchAssetStatus.ERROR,
        requestId,
        error: "WebSocket connection reset",
      });
    }
    this.#fetchAssetRequests.clear();
    this.#parameterTypeByName.clear();
    this.#messageSizeEstimateByTopic = {};
  }

  #updateDataTypes(datatypes: MessageDefinitionMap): void {
    let updatedDatatypes: MessageDefinitionMap | undefined = undefined;
    const maybeRos = ["ros1", "ros2"].includes(this.#profile ?? "");
    for (const [name, types] of datatypes) {
      const knownTypes = this.#datatypes.get(name);
      if (knownTypes && !isMsgDefEqual(types, knownTypes)) {
        this.#alerts.addAlert(`schema-changed-${name}`, {
          message: `Definition of schema '${name}' has changed during the server's runtime`,
          severity: "error",
        });
      } else {
        updatedDatatypes ??= new Map(this.#datatypes);
        updatedDatatypes.set(name, types);

        const fullTypeName = dataTypeToFullName(name);
        if (maybeRos && fullTypeName !== name) {
          updatedDatatypes.set(fullTypeName, {
            ...types,
            name: types.name ? dataTypeToFullName(types.name) : undefined,
          });
        }
      }
    }
    if (updatedDatatypes != undefined) {
      this.#datatypes = updatedDatatypes; // Signal that datatypes changed.
    }
  }
}
