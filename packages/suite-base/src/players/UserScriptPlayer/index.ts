// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import * as Comlink from "@foxglove/comlink";
import { Time, compare } from "@foxglove/rostime";
import { Mutex } from "async-mutex";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";

import { MutexLocked } from "@lichtblick/den/async";
import { filterMap, VecQueue } from "@lichtblick/den/collection";
import Log from "@lichtblick/log";
import type { IWritable } from "@lichtblick/mcap-core";
import { Immutable, Metadata, ParameterValue } from "@lichtblick/suite";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import {
  GetBackfillMessagesArgs,
  IteratorResult as IIterableSourceIteratorResult,
} from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { MemoizedLibGenerator } from "@lichtblick/suite-base/players/UserScriptPlayer/MemoizedLibGenerator";
import { generateTypesLib } from "@lichtblick/suite-base/players/UserScriptPlayer/transformerWorker/generateTypesLib";
import { TransformArgs } from "@lichtblick/suite-base/players/UserScriptPlayer/transformerWorker/types";
import {
  Diagnostic,
  ProcessMessages,
  ScriptRegistration,
  UserScriptLog,
} from "@lichtblick/suite-base/players/UserScriptPlayer/types";
import { hasTransformerErrors } from "@lichtblick/suite-base/players/UserScriptPlayer/utils";
import { isRecordingSource } from "@lichtblick/suite-base/players/constants";
import {
  AdvertiseOptions,
  BlockCache,
  MessageBlock,
  MessageEvent,
  Player,
  PlayerAlert,
  PlayerState,
  PlayerStateActiveData,
  Progress,
  PublishPayload,
  SubscribePayload,
  Topic,
} from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { UserScript, UserScripts } from "@lichtblick/suite-base/types/panels";
import { basicDatatypes } from "@lichtblick/suite-base/util/basicDatatypes";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";
import { toError } from "@lichtblick/suite-base/util/toError";

import { RuntimeWorker, RuntimeWorkerPool } from "./RuntimeWorkerPool";
import {
  DIAGNOSTIC_SEVERITY,
  ERROR_CODES,
  MAX_GLOBAL_BUFFER_SIZE,
  SOURCES,
  TRANSFORM_BATCH_SIZE,
} from "./constants";
import { getPreloadTypes, remapVirtualSubscriptions } from "./subscriptions";
import {
  buildTopicConverterRegistration,
  InstalledTopicConverter,
  topicConverterNamesValid,
  topicConverterOutput,
} from "./topicConverters";
import type { TransformerWorkerApi } from "./transformerWorker";

const log = Log.getLogger(__filename);

const TOPIC_CONVERTER_ALERT_PREFIX = "topic-converter:";
// Not cleared by resets while preloaded blocks are converted: a failed block is not converted
// again, so its alert would not come back. Cleared when the converted blocks are dropped.
const TOPIC_CONVERTER_FAILED_ALERT_PREFIX = "topic-converter-failed:";

// TypeScript's built-in lib only accepts strings for the scriptURL. However, webpack only
// understands `new URL()` to properly build the worker entry point:
// https://github.com/webpack/webpack/issues/13043
declare let SharedWorker: {
  prototype: SharedWorker;
  new (scriptURL: URL, options?: string | WorkerOptions): SharedWorker;
};

type UserScriptActions = {
  setUserScriptDiagnostics: (scriptId: string, diagnostics: readonly Diagnostic[]) => void;
  addUserScriptLogs: (scriptId: string, logs: readonly UserScriptLog[]) => void;
  setUserScriptRosLib: (rosLib: string) => void;
  setUserScriptTypesLib: (lib: string) => void;
};

type ScriptRegistrationCacheItem = {
  scriptId: string;
  userScript: UserScript;
  result: ScriptRegistration;
};

/** Mutable state protected by a mutex lock */
type ProtectedState = {
  scriptRegistrationCache: ScriptRegistrationCacheItem[];
  scriptRegistrations: readonly ScriptRegistration[];
  lastPlayerStateActiveData?: PlayerStateActiveData;
  userScripts: UserScripts;

  /**
   * Map of output topics to input topics. To produce an output we need to know the input topics
   * that a script requires. When subscribers subscribe to the output topic, the user script player
   * subscribes to the underlying input topics.
   */
  inputsByOutputTopic: Map<string, readonly string[]>;
};

type CacheConsumerHandle = { index: number };

/** What converting a preloaded block with topic converters depends on. */
type BlockConversion = {
  needed: readonly ScriptRegistration[];
  sourceTopics: readonly string[];
  outputTopics: ReadonlySet<string>;
  globalVariables: GlobalVariables;
};

type BatchIteratorCacheEntry = {
  topic: string;
  /** Results not yet read by every consumer; `results.at(0)` has index `pruneOffset`. */
  results: VecQueue<Readonly<IIterableSourceIteratorResult>>;
  done: boolean;
  error?: Error;
  /** Resolved (and replaced) whenever results are added or consumed, or the cache stops. */
  resolve: () => void;
  promise: Promise<void>;
  processor: { terminate: () => void };
  consumers: Set<CacheConsumerHandle>;
  pruneOffset: number;
};

function isSortedByReceiveTime(messages: readonly MessageEvent[]): boolean {
  for (let i = 1; i < messages.length; i++) {
    if (compare(messages[i - 1]!.receiveTime, messages[i]!.receiveTime) > 0) {
      return false;
    }
  }
  return true;
}

/**
 * Groups registrations into stages: each stage only reads data-source topics and outputs of earlier
 * stages, so topic converters can be chained. Registrations in a dependency cycle (or depending on
 * one) never become ready and are returned as `cyclic`.
 */
function dependencyStages(registrations: readonly ScriptRegistration[]): {
  stages: ScriptRegistration[][];
  cyclic: ScriptRegistration[];
} {
  const stages: ScriptRegistration[][] = [];
  let pending = registrations;
  for (;;) {
    const pendingOutputs = new Set(pending.map(({ output }) => output.name));
    const ready = pending.filter(
      ({ inputs }) => !inputs.some((input) => pendingOutputs.has(input)),
    );
    if (ready.length === 0) {
      return { stages, cyclic: [...pending] };
    }
    stages.push(ready);
    pending = pending.filter((registration) => !ready.includes(registration));
  }
}

/** The registrations producing `topics`, plus every registration they read from. */
function withDependencies(
  registrations: Iterable<ScriptRegistration>,
  topics: Iterable<string>,
): ScriptRegistration[] {
  const byOutput = new Map<string, ScriptRegistration>();
  for (const registration of registrations) {
    byOutput.set(registration.output.name, registration);
  }
  const needed = new Set<ScriptRegistration>();
  const visit = (topic: string) => {
    const registration = byOutput.get(topic);
    if (registration && !needed.has(registration)) {
      needed.add(registration);
      registration.inputs.forEach(visit);
    }
  };
  for (const topic of topics) {
    visit(topic);
  }
  return [...needed];
}

const isTopicConverter = ({ scriptId }: ScriptRegistration) =>
  scriptId.startsWith(TOPIC_CONVERTER_ALERT_PREFIX);

const byReceiveTime = (a: MessageEvent, b: MessageEvent) => compare(a.receiveTime, b.receiveTime);

/**
 * Runs `registrations` over `messages` (sorted by receive time) stage by stage; later stages also
 * see the outputs of earlier ones. Returns only the outputs.
 */
async function runRegistrations(
  messages: readonly MessageEvent[],
  registrations: readonly ScriptRegistration[],
  process: (
    registration: ScriptRegistration,
    inputs: readonly MessageEvent[],
  ) => Promise<readonly (MessageEvent | undefined)[]>,
): Promise<MessageEvent[]> {
  const outputs: MessageEvent[] = [];
  let available = messages;
  for (const stage of dependencyStages(registrations).stages) {
    // One worker round trip per script; scripts in a stage run in parallel.
    const stageInputs = available;
    const stageOutputs = (
      await Promise.all(
        stage.map(async (registration) => {
          const inputs = stageInputs.filter(({ topic }) => registration.inputs.includes(topic));
          return inputs.length === 0
            ? []
            : filterMap(await process(registration, inputs), (message) => message);
        }),
      )
    ).flat();
    if (stageOutputs.length > 0) {
      outputs.push(...stageOutputs);
      available = available.concat(stageOutputs).sort(byReceiveTime);
    }
  }
  return outputs;
}

/** Runs `registrations` over `messages` with fresh processor instances, terminated afterwards. */
async function runFresh(
  messages: readonly MessageEvent[],
  registrations: readonly ScriptRegistration[],
  globalVariables: GlobalVariables,
): Promise<MessageEvent[]> {
  const processors = new Map(registrations.map((r) => [r, r.buildMessageProcessor()]));
  try {
    return await runRegistrations(
      messages,
      registrations,
      async (registration, inputs) =>
        await processors.get(registration)!.processMessages(inputs, globalVariables),
    );
  } finally {
    for (const processor of processors.values()) {
      processor.terminate();
    }
  }
}

export default class UserScriptPlayer implements Player {
  #player: Player;

  // Datatypes and topics are derived from scriptRegistrations, but memoized so they only change when needed
  #memoizedScriptDatatypes: readonly RosDatatypes[] = [];
  #memoizedScriptTopics: readonly Topic[] = [];

  #subscriptions: SubscribePayload[] = [];
  #subscriptionGeneration: number | undefined;
  #scriptSubscriptions: Record<string, SubscribePayload> = {};

  // listener for state updates
  #listener?: (arg0: PlayerState) => Promise<void>;

  // Owns every runtime worker; close() disposes it so no worker outlives the player.
  readonly #runtimeWorkers = new RuntimeWorkerPool(() => UserScriptPlayer.CreateRuntimeWorker());
  #setUserScriptDiagnostics: (scriptId: string, diagnostics: readonly Diagnostic[]) => void;
  #addUserScriptLogs: (scriptId: string, logs: UserScriptLog[]) => void;
  #transformRpc?: Comlink.Remote<TransformerWorkerApi>;
  #globalVariables: GlobalVariables = {};
  #userScriptActions: UserScriptActions;
  #rosLibGenerator: MemoizedLibGenerator;
  #typesLibGenerator: MemoizedLibGenerator;

  // Player state changes when the child player invokes our player state listener
  // we may also emit state changes on internal errors
  #playerState?: PlayerState;

  // The store tracks alerts for individual user scripts
  // a script may set its own alert or clear its alert
  #alertStore = new Map<string, PlayerAlert>();
  // Last merged child + script alerts, reused while unchanged so consumers don't re-render per frame
  #mergedAlerts?: PlayerAlert[];

  // Last message per delivered topic, to rerun an edited user script (the first one too) on its
  // possibly new inputs. These are the messages panels and the message pipeline hold anyway, so it
  // costs little; pruned like the pipeline's own cache (see #pruneLastMessages).
  #lastMessageByInputTopic = new Map<string, MessageEvent>();
  // Aliased topic name -> the topic it is aliased from. An alias and its source carry the same
  // events, so pruning treats them as one topic.
  #aliasSources = memoizeWeak(
    (topics: readonly Topic[]) =>
      new Map(
        filterMap(topics, ({ name, aliasedFromName }) =>
          aliasedFromName != undefined ? ([name, aliasedFromName] as const) : undefined,
        ),
      ),
  );
  #userScriptIdsNeedUpdate = new Set<string>();

  #protectedState = new MutexLocked<ProtectedState>({
    userScripts: {},
    scriptRegistrations: [],
    scriptRegistrationCache: [],
    lastPlayerStateActiveData: undefined,
    inputsByOutputTopic: new Map(),
  });

  // Shadow copy of script registrations keyed by output topic for synchronous access
  // in getBatchIterator (which can't use the async MutexLocked).
  // Updated in #resetWorkersUnlocked.
  #outputTopicRegistrations = new Map<string, ScriptRegistration>();

  // Shared cache for virtual topic batch iterators. One source consumer per topic processes
  // messages through its own worker; multiple panels replay from the shared results array.
  readonly #batchIteratorCache = new Map<string, BatchIteratorCacheEntry>();

  readonly #emitLock = new Mutex();

  // Foxglove topic converters from extensions; they run in this thread like user scripts.
  #topicConverters: Immutable<InstalledTopicConverter[]> = [];

  // Registration per installed converter, kept across resets (e.g. seeks) like user script
  // registrations, so the preloaded outputs below stay valid. terminate() still resets its state.
  #topicConverterRegistrationCache = new WeakMap<
    Immutable<InstalledTopicConverter>,
    ScriptRegistration
  >();

  // Preloaded blocks with topic converter outputs added, per source block. Replaced (dropping all
  // entries) whenever the converters producing them or their source topics change.
  #convertedBlocks = new WeakMap<MessageBlock, MessageBlock>();
  #convertedBlocksKey: {
    needed: readonly ScriptRegistration[];
    topics: string;
    variables: unknown[];
  } = { needed: [], topics: "", variables: [] };
  // What the key above was computed from; when none of it changed, neither did the key.
  #convertedBlocksInputs: unknown[] = [];
  #lastMessageCache?: { source: BlockCache; converted: BlockCache };

  // exposed as a static to allow testing to mock/replace
  public static CreateTransformWorker = (): SharedWorker => {
    return new SharedWorker(new URL("./transformerWorker/index", import.meta.url), {
      // Although we are using SharedWorkers, we do not actually want to share worker instances
      // between tabs. We achieve this by passing in a unique name.
      name: randomUUID(),
    });
  };

  // exposed as a static to allow testing to mock/replace
  public static CreateRuntimeWorker = (): SharedWorker => {
    return new SharedWorker(new URL("./runtimeWorker/index", import.meta.url), {
      // Although we are using SharedWorkers, we do not actually want to share worker instances
      // between tabs. We achieve this by passing in a unique name.
      name: randomUUID(),
    });
  };

  /** Absent when the wrapped player has none, so callers fall back to their own lookup. */
  public readonly fetchAsset?: Player["fetchAsset"];

  public constructor(player: Player, userScriptActions: UserScriptActions) {
    this.#player = player;
    this.fetchAsset = player.fetchAsset?.bind(player);
    this.#userScriptActions = userScriptActions;
    const { setUserScriptDiagnostics, addUserScriptLogs } = userScriptActions;

    this.#setUserScriptDiagnostics = (scriptId: string, diagnostics: readonly Diagnostic[]) => {
      setUserScriptDiagnostics(scriptId, diagnostics);
    };
    this.#addUserScriptLogs = (scriptId: string, logs: UserScriptLog[]) => {
      if (logs.length > 0) {
        addUserScriptLogs(scriptId, logs);
      }
    };

    this.#typesLibGenerator = new MemoizedLibGenerator(async (args) => {
      const lib = generateTypesLib({
        topics: args.topics,
        datatypes: new Map([...basicDatatypes, ...args.datatypes]),
      });

      // Do not prettify the types library as it can cause severe performance
      // degradations. This is OK because the generated types library is
      // read-only and should be rarely read by a human. Further, the
      // not-prettified code is not that bad either. It just lacks the
      // appropriate indentations.
      return lib;
    });

    this.#rosLibGenerator = new MemoizedLibGenerator(async (args) => {
      const transformWorker = this.#getTransformWorker();
      return await transformWorker.generateRosLib({
        topics: args.topics,
        // Include basic datatypes along with any custom datatypes.
        // Custom datatypes appear as the second array items to override any basicDatatype items
        datatypes: new Map([...basicDatatypes, ...args.datatypes]),
      });
    });
  }

  #getTopics = memoizeWeak((topics: readonly Topic[], scriptTopics: readonly Topic[]): Topic[] => [
    ...topics,
    ...scriptTopics,
  ]);

  #getDatatypes = memoizeWeak(
    (datatypes: RosDatatypes, scriptDatatypes: readonly RosDatatypes[]): RosDatatypes => {
      return scriptDatatypes.reduce(
        (allDatatypes, userScriptDatatypes) => new Map([...allDatatypes, ...userScriptDatatypes]),
        new Map([...basicDatatypes, ...datatypes]),
      );
    },
  );

  // Processes input messages through scripts to create messages on output topics
  async #getMessages(
    inputMessages: readonly MessageEvent[],
    globalVariables: GlobalVariables,
    scriptRegistrations: readonly ScriptRegistration[],
  ): Promise<readonly MessageEvent[]> {
    // fast-track if there's no input or no scripts and return empty output
    if (inputMessages.length === 0 || scriptRegistrations.length === 0) {
      return [];
    }

    // Run what subscribers want, plus the scripts or converters those read from.
    const outputs = await runRegistrations(
      inputMessages,
      withDependencies(scriptRegistrations, Object.keys(this.#scriptSubscriptions)),
      async (registration, inputs) => await registration.processMessages(inputs, globalVariables),
    );
    return outputs.filter(({ topic }) => this.#scriptSubscriptions[topic] != undefined);
  }

  public setGlobalVariables(globalVariables: GlobalVariables): void {
    this.#globalVariables = globalVariables;
    this.#player.setGlobalVariables?.(globalVariables);
  }

  // Called when userScript state is updated (i.e. scripts are saved)
  public async setUserScripts(userScripts: UserScripts): Promise<void> {
    const newPlayerState = await this.#protectedState.runExclusive(async (state) => {
      for (const scriptId of Object.keys(userScripts)) {
        const prevScript = state.userScripts[scriptId];
        const newScript = userScripts[scriptId];
        if (prevScript && newScript && prevScript.sourceCode !== newScript.sourceCode) {
          // if source code of a user script changed then we need to mark it for re-processing input messages
          this.#userScriptIdsNeedUpdate.add(scriptId);
        }
      }
      state.userScripts = userScripts;

      // Prune the script registration cache so it doesn't grow forever.
      // We add one to the count so we don't have to recompile scripts if users undo/redo script changes.
      const maxScriptRegistrationCacheCount = Object.keys(userScripts).length + 1;
      // Entries are pushed (or moved) to the end when used, so the most recent are at the end.
      state.scriptRegistrationCache = state.scriptRegistrationCache.slice(
        -maxScriptRegistrationCacheCount,
      );
      // This code causes us to reset workers twice because the seeking resets the workers too
      this.#invalidateBatchIteratorCache();
      // Create new Topic objects so downstream consumers (e.g. PlotCoordinator) can detect
      // which specific topics had their preloaded data invalidated via reference comparison.
      this.#memoizedScriptTopics = this.#memoizedScriptTopics.map((t) => ({ ...t }));
      await this.#resetWorkersUnlocked(state);
      this.#pruneLastMessages(state, this.#setSubscriptionsUnlocked(this.#subscriptions, state));

      return this.#pausedStateToReemit(state);
    });

    if (newPlayerState) {
      await this.#onPlayerState(newPlayerState);
    }
  }

  /** Called when the installed Foxglove topic converters change. */
  public async setTopicConverters(converters: Immutable<InstalledTopicConverter[]>): Promise<void> {
    const newPlayerState = await this.#protectedState.runExclusive(async (state) => {
      this.#topicConverters = converters;
      this.#invalidateBatchIteratorCache();
      this.#memoizedScriptTopics = this.#memoizedScriptTopics.map((t) => ({ ...t }));
      await this.#resetWorkersUnlocked(state);
      this.#setSubscriptionsUnlocked(this.#subscriptions, state);
      return this.#pausedStateToReemit(state);
    });

    if (newPlayerState) {
      await this.#onPlayerState(newPlayerState);
    }
  }

  // If we have previous player state and are paused, then we re-emit the last active data so
  // any panels that want our output topic get the updated message.
  //
  // Note: Until we learn otherwise, we assume that if a player is playing, it will emit new
  // player state that will output new messages so we don't emit here while playing.
  #pausedStateToReemit(state: ProtectedState): PlayerState | undefined {
    const playerState = this.#playerState;
    const lastActive = state.lastPlayerStateActiveData;
    if (playerState && lastActive?.isPlaying === false) {
      return {
        ...playerState,
        activeData: {
          ...lastActive,
          // We want to avoid re-emitting upstream data source messages into panels to maintain
          // the invariant that the player emits a data-source message into "currentFrame" only once.
          //
          // Using an empty messages array will make user script player only emit the script output
          // messages as a result of the updated script.
          messages: [],
        },
      };
    }
    return undefined;
  }

  // Defines the inputs/outputs and worker interface of a user script.
  async #createScriptRegistration(
    scriptId: string,
    userScript: UserScript,
    state: ProtectedState,
    rosLib: string,
    typesLib: string,
  ): Promise<ScriptRegistration> {
    const cache = state.scriptRegistrationCache;
    const hit = cache.findIndex(
      (entry) => entry.scriptId === scriptId && _.isEqual(userScript, entry.userScript),
    );
    if (hit !== -1) {
      // Move it to the end so pruning (which keeps the tail) keeps recently used entries
      const [entry] = cache.splice(hit, 1);
      cache.push(entry!);
      return entry!.result;
    }
    // Pass all the scripts a set of basic datatypes that we know how to render.
    // These could be overwritten later by bag datatypes, but these datatype definitions should be very stable.
    const { topics = [], datatypes = new Map() } = state.lastPlayerStateActiveData ?? {};
    const scriptDatatypes: RosDatatypes = new Map([...basicDatatypes, ...datatypes]);

    const { name, sourceCode } = userScript;
    const transformMessage: TransformArgs = {
      name,
      sourceCode,
      topics,
      rosLib,
      typesLib,
      datatypes: scriptDatatypes,
    };
    const transformWorker = this.#getTransformWorker();
    const scriptData = await transformWorker.transform(transformMessage);
    const { inputTopics, outputTopic, transpiledCode, projectCode, outputDatatype } = scriptData;

    // alertKey is a unique identifier for each user script so we can manage alerts from
    // a specific script. A script may have a problem that may later clear. Using the key we can add/remove
    // alerts for specific user scripts independently of other user scripts.
    const alertKey = `script-id-${scriptId}`;
    const errorAlert: PlayerAlert = {
      severity: "error",
      message: `User Script ${scriptData.name} encountered an error.`,
      tip: "Open the User Scripts panel and check the Alerts tab for errors.",
    };
    const noMessageAlert: PlayerAlert = {
      severity: "warn",
      message: `User Script ${scriptData.name} did not produce a message.`,
      tip: "Check that all code paths in the user script return a message.",
    };
    const onRuntimeError = (message: string) => {
      this.#alertStore.set(alertKey, {
        severity: "error",
        message: `User script runtime error: ${message}`,
      });
      void this.#queueEmitState();
    };

    const buildMessageProcessor: ScriptRegistration["buildMessageProcessor"] = () => {
      // Worker for this processor, taken from the pool on first use.
      let worker: RuntimeWorker | undefined;

      const processMessages: ProcessMessages = async (msgEvents, globalVariables) => {
        if (msgEvents.length === 0) {
          return [];
        }
        // Register the script within a web worker to be executed.
        if (!worker) {
          worker = this.#runtimeWorkers.acquire(onRuntimeError);
          const { error, userScriptDiagnostics, userScriptLogs } = await worker.rpc.registerScript({
            projectCode,
            scriptCode: transpiledCode,
          });
          if (error != undefined) {
            this.#setUserScriptDiagnostics(scriptId, [
              ...userScriptDiagnostics,
              {
                source: SOURCES.Runtime,
                severity: DIAGNOSTIC_SEVERITY.Error,
                message: error,
                code: ERROR_CODES.RUNTIME,
              },
            ]);
            return msgEvents.map(() => undefined);
          }
          this.#addUserScriptLogs(scriptId, userScriptLogs);
        }

        const results = await worker.rpc.processMessages({
          messages: msgEvents.map((msgEvent) => ({
            topic: msgEvent.topic,
            receiveTime: msgEvent.receiveTime,
            message: msgEvent.message,
            datatype: msgEvent.schemaName,
          })),
          globalVariables,
        });

        // Apply the results in order, as if the messages had been processed one by one: the
        // alert reflects the last message, diagnostics the last failing one.
        const logs: UserScriptLog[] = [];
        let diagnostics: Diagnostic[] | undefined;
        let alert: PlayerAlert | undefined;
        const outputs = results.map((result, i): MessageEvent | undefined => {
          for (const entry of result.userScriptLogs) {
            logs.push(entry);
          }
          const allDiagnostics = result.userScriptDiagnostics;
          if (result.error) {
            allDiagnostics.push({
              source: SOURCES.Runtime,
              severity: DIAGNOSTIC_SEVERITY.Error,
              message: result.error,
              code: ERROR_CODES.RUNTIME,
            });
          }
          if (allDiagnostics.length > 0) {
            diagnostics = allDiagnostics;
            alert = errorAlert;
            return undefined;
          }
          if (!result.message) {
            alert = noMessageAlert;
            return undefined;
          }
          alert = undefined;
          const msgEvent = msgEvents[i]!;
          return {
            topic: outputTopic,
            receiveTime: msgEvent.receiveTime,
            message: result.message,
            sizeInBytes: msgEvent.sizeInBytes,
            schemaName: outputDatatype,
          };
        });

        this.#addUserScriptLogs(scriptId, logs);
        if (alert) {
          this.#alertStore.set(alertKey, alert);
        } else {
          // We received a message successfully, so clear any previous problem from this script.
          this.#alertStore.delete(alertKey);
        }
        if (diagnostics) {
          this.#setUserScriptDiagnostics(scriptId, diagnostics);
        }
        return outputs;
      };

      const terminate = () => {
        this.#alertStore.delete(alertKey);
        if (worker) {
          this.#runtimeWorkers.release(worker);
          worker = undefined;
        }
      };

      return { processMessages, terminate };
    };

    const messageProcessor = buildMessageProcessor();

    const result: ScriptRegistration = {
      scriptId,
      scriptData,
      inputs: inputTopics,
      output: { name: outputTopic, schemaName: outputDatatype },
      processMessages: messageProcessor.processMessages,
      buildMessageProcessor,
      terminate: messageProcessor.terminate,
    };
    state.scriptRegistrationCache.push({ scriptId, userScript, result });
    return result;
  }

  #getTransformWorker(): Comlink.Remote<TransformerWorkerApi> {
    if (!this.#transformRpc) {
      const worker = UserScriptPlayer.CreateTransformWorker();

      // The errors below persist for the lifetime of the player.
      // They are not cleared because they are irrecoverable.

      worker.onerror = (event) => {
        log.error(event);

        this.#alertStore.set("worker-error", {
          severity: "error",
          message: `User Script error: ${event.message}`,
        });

        void this.#queueEmitState();
      };

      const port: MessagePort = worker.port;
      port.onmessageerror = (event) => {
        log.error(event);

        this.#alertStore.set("worker-error", {
          severity: "error",
          message: `User Script error: ${String(event.data)}`,
        });

        void this.#queueEmitState();
      };
      port.start();
      const rpc = Comlink.wrap<TransformerWorkerApi>(port);

      void rpc.onError(
        Comlink.proxy((msg: string) => {
          log.error(msg);

          this.#alertStore.set("worker-error", {
            severity: "error",
            message: `User Script error: ${msg}`,
          });

          void this.#queueEmitState();
        }),
      );

      this.#transformRpc = rpc;
    }
    return this.#transformRpc;
  }

  // We need to reset workers in a variety of circumstances:
  // - When a user script is updated, added or deleted
  // Invalidate shared batch iterator cache. Called when scripts or topics/datatypes change
  // (NOT on seek — seek doesn't affect preloaded block data and PlotCoordinator won't re-subscribe).
  #invalidateBatchIteratorCache() {
    for (const cache of this.#batchIteratorCache.values()) {
      this.#stopCache(cache);
    }
    this.#batchIteratorCache.clear();
  }

  // - When we seek (in order to reset state)
  // - When a new child player is added
  async #resetWorkersUnlocked(state: ProtectedState): Promise<void> {
    if (!state.lastPlayerStateActiveData) {
      return;
    }

    // This early return is an optimization measure so that the
    // `scriptRegistrations` array is not re-defined, which will invalidate
    // downstream caches. (i.e. `this._getTopics`)
    if (
      state.scriptRegistrations.length === 0 &&
      Object.entries(state.userScripts).length === 0 &&
      this.#topicConverters.length === 0
    ) {
      return;
    }

    // teardown and cleanup any existing script registrations
    for (const scriptRegistration of state.scriptRegistrations) {
      scriptRegistration.terminate();
    }
    state.scriptRegistrations = [];

    // Libs are only needed to compile user scripts; topic converters alone don't need them.
    let allScriptRegistrations: ScriptRegistration[] = [];
    if (state.scriptRegistrations.length > 0 || Object.keys(state.userScripts).length > 0) {
      const rosLib = await this.#getLib(
        state,
        this.#rosLibGenerator,
        this.#userScriptActions.setUserScriptRosLib,
      );
      const typesLib = await this.#getLib(
        state,
        this.#typesLibGenerator,
        this.#userScriptActions.setUserScriptTypesLib,
      );

      allScriptRegistrations = await Promise.all(
        Object.entries(state.userScripts).map(
          async ([scriptId, userScript]) =>
            await this.#createScriptRegistration(scriptId, userScript, state, rosLib, typesLib),
        ),
      );
    }

    const validScriptRegistrations: ScriptRegistration[] = [];
    const playerTopics = new Set(state.lastPlayerStateActiveData.topics.map((topic) => topic.name));
    const allScriptOutputs = new Set(
      allScriptRegistrations.map(({ scriptData }) => scriptData.outputTopic),
    );

    // Clear the output -> input map and re-populate it again with with all the script registrations
    state.inputsByOutputTopic.clear();

    for (const scriptRegistration of allScriptRegistrations) {
      const { scriptData, scriptId } = scriptRegistration;

      if (!scriptData.outputTopic) {
        this.#setUserScriptDiagnostics(scriptId, [
          ...scriptData.diagnostics,
          {
            severity: DIAGNOSTIC_SEVERITY.Error,
            message: `Output topic cannot be an empty string.`,
            source: SOURCES.OutputTopicChecker,
            code: ERROR_CODES.OutputTopicChecker.NOT_UNIQUE,
          },
        ]);
        continue;
      }

      // Create diagnostic errors if more than one script outputs to the same topic
      if (state.inputsByOutputTopic.has(scriptData.outputTopic)) {
        this.#setUserScriptDiagnostics(scriptId, [
          ...scriptData.diagnostics,
          {
            severity: DIAGNOSTIC_SEVERITY.Error,
            message: `Output "${scriptData.outputTopic}" must be unique`,
            source: SOURCES.OutputTopicChecker,
            code: ERROR_CODES.OutputTopicChecker.NOT_UNIQUE,
          },
        ]);
        continue;
      }

      // Record the required input topics to service this output topic
      state.inputsByOutputTopic.set(scriptData.outputTopic, scriptData.inputTopics);

      // Create diagnostic errors if script outputs overlap with real topics
      if (playerTopics.has(scriptData.outputTopic)) {
        this.#setUserScriptDiagnostics(scriptId, [
          ...scriptData.diagnostics,
          {
            severity: DIAGNOSTIC_SEVERITY.Error,
            message: `Output topic "${scriptData.outputTopic}" is already present in the data source`,
            source: SOURCES.OutputTopicChecker,
            code: ERROR_CODES.OutputTopicChecker.EXISTING_TOPIC,
          },
        ]);
        continue;
      }

      // Filter out scripts with compilation errors
      if (hasTransformerErrors(scriptData)) {
        this.#setUserScriptDiagnostics(scriptId, scriptData.diagnostics);
        continue;
      }

      // Throw if scripts use other scripts' outputs as inputs. We should never get here because we
      // already prevent outputs from being the same as real topics in the data source, and we
      // already filter out input topics that aren't present in the data source.
      for (const input of scriptData.inputTopics) {
        if (allScriptOutputs.has(input)) {
          throw new Error(`Input "${input}" cannot equal another script's output`);
        }
      }
      validScriptRegistrations.push(scriptRegistration);
    }

    validScriptRegistrations.push(...this.#topicConverterRegistrations(state, playerTopics));

    let changedTopicsRequireEmitState = false;
    state.scriptRegistrations = validScriptRegistrations;

    // Atomically replace shadow registry for synchronous access in getBatchIterator.
    // We avoid clearing the old map earlier because getBatchIterator is synchronous and
    // could be called during the async gap above — stale-but-functional registrations
    // are better than an empty map that causes panels to get no iterator.
    const newOutputTopicRegistrations = new Map<string, ScriptRegistration>();
    for (const reg of validScriptRegistrations) {
      newOutputTopicRegistrations.set(reg.output.name, reg);
    }
    this.#outputTopicRegistrations = newOutputTopicRegistrations;

    const scriptTopics = state.scriptRegistrations.map(({ output }) => output);
    if (!_.isEqual(scriptTopics, this.#memoizedScriptTopics)) {
      this.#memoizedScriptTopics = scriptTopics;
      changedTopicsRequireEmitState = true;
    }
    const scriptDatatypes = state.scriptRegistrations.map(
      ({ scriptData: { datatypes } }) => datatypes,
    );
    if (!_.isEqual(scriptDatatypes, this.#memoizedScriptDatatypes)) {
      this.#memoizedScriptDatatypes = scriptDatatypes;
      changedTopicsRequireEmitState = true;
    }

    for (const scriptRegistration of state.scriptRegistrations) {
      if (!isTopicConverter(scriptRegistration)) {
        this.#setUserScriptDiagnostics(scriptRegistration.scriptId, []);
      }
    }

    // If we have new topics after processing the script registrations we need to emit a new
    // state to let downstream clients subscribe to newly available topics. This is
    // necessary because we won't emit a new state otherwise if there are no other active
    // subscriptions.
    if (changedTopicsRequireEmitState && this.#playerState?.activeData) {
      const newTopics = _.unionBy(
        this.#playerState.activeData.topics,
        this.#memoizedScriptTopics,
        (top) => top.name,
      );
      const newDatatypes = this.#getDatatypes(
        this.#playerState.activeData.datatypes,
        this.#memoizedScriptDatatypes,
      );
      this.#playerState = {
        ...this.#playerState,
        activeData: {
          ...this.#playerState.activeData,
          datatypes: newDatatypes,
          topics: newTopics,
        },
      };
      await this.#queueEmitState();
    }
  }

  /**
   * Registrations for the installed topic converters whose output topic is usable; the others are
   * reported as player alerts. Must run after user script outputs are in `inputsByOutputTopic`.
   */
  #topicConverterRegistrations(
    state: ProtectedState,
    playerTopics: ReadonlySet<string>,
  ): ScriptRegistration[] {
    // "topic-converter" also matches the failed alerts, kept while preloaded blocks are converted.
    this.#deleteAlerts(this.#lastMessageCache ? TOPIC_CONVERTER_ALERT_PREFIX : "topic-converter");

    const registrations: ScriptRegistration[] = [];
    for (const installed of this.#topicConverters) {
      const { topic, schemaName } = topicConverterOutput(installed.converter);
      const alertKey = `${TOPIC_CONVERTER_ALERT_PREFIX}${installed.extensionId}:${topic}`;
      const problem =
        topic === "" || schemaName === "" || typeof installed.converter.create !== "function"
          ? "needs an output topic, an output schema name and a create function"
          : !topicConverterNamesValid(installed.converter)
            ? "needs inputTopics and watchVariables to be lists of names"
            : playerTopics.has(topic)
              ? "outputs to a topic that is already present in the data source"
              : state.inputsByOutputTopic.has(topic)
                ? "outputs to a topic that another user script or topic converter already produces"
                : undefined;
      if (problem) {
        this.#alertStore.set(alertKey, {
          severity: "error",
          message: `Topic converter for "${topic}" from extension ${installed.extensionId} ${problem}.`,
        });
        continue;
      }

      let registration = this.#topicConverterRegistrationCache.get(installed);
      if (!registration) {
        registration = buildTopicConverterRegistration(installed, (error) => {
          this.#alertStore.set(
            `${TOPIC_CONVERTER_FAILED_ALERT_PREFIX}${installed.extensionId}:${topic}`,
            {
              severity: "error",
              message: `Topic converter for "${topic}" from extension ${installed.extensionId} failed.`,
              error: toError(error),
            },
          );
          void this.#queueEmitState();
        });
        this.#topicConverterRegistrationCache.set(installed, registration);
      }
      state.inputsByOutputTopic.set(topic, registration.inputs);
      registrations.push(registration);
    }

    // Converters may read other converters' or user scripts' outputs, but not in a cycle.
    const { cyclic } = dependencyStages(registrations);
    for (const registration of cyclic) {
      const topic = registration.output.name;
      state.inputsByOutputTopic.delete(topic);
      this.#alertStore.set(registration.scriptId, {
        severity: "error",
        message: `Topic converter for "${topic}" reads its own output through a cycle of topic converters.`,
      });
    }
    return registrations.filter((registration) => !cyclic.includes(registration));
  }

  /**
   * Adds the outputs of topic converters subscribed with `preloadType: "full"` to the preloaded
   * blocks, so they show up in `allFrames`. Each block is converted once, with fresh converter
   * instances, as soon as all of its source inputs are loaded.
   */
  async #withConvertedBlocks(
    progress: Progress,
    registrations: readonly ScriptRegistration[],
  ): Promise<Progress> {
    const source = progress.messageCache;
    if (!source) {
      return progress;
    }
    const keyInputs = [registrations, this.#scriptSubscriptions, this.#globalVariables];
    if (
      this.#lastMessageCache?.source === source &&
      keyInputs.every((input, i) => input === this.#convertedBlocksInputs[i])
    ) {
      return { ...progress, messageCache: this.#lastMessageCache.converted };
    }
    this.#convertedBlocksInputs = keyInputs;
    const converters = registrations.filter(isTopicConverter);
    const preloaded = converters.filter(
      ({ output }) => this.#scriptSubscriptions[output.name]?.preloadType === "full",
    );
    if (preloaded.length === 0) {
      if (this.#lastMessageCache) {
        this.#deleteAlerts(TOPIC_CONVERTER_FAILED_ALERT_PREFIX);
      }
      this.#lastMessageCache = undefined;
      return progress;
    }
    const outputTopics = new Set(preloaded.map(({ output }) => output.name));
    // User script outputs are never in blocks, so converters reading them get no input there.
    const needed = withDependencies(converters, outputTopics);
    const virtualTopics = new Set(registrations.map(({ output }) => output.name));
    const sourceTopics = _.uniq(
      needed.flatMap(({ inputs }) => inputs.filter((input) => !virtualTopics.has(input))),
    );
    // Seeks rebuild the registrations array but reuse the converter registrations, so this key
    // stays the same and the converted blocks survive them.
    const globalVariables = this.#globalVariables;
    const key = {
      needed,
      topics: [...[...outputTopics].sort(), "", ...sourceTopics].join("\n"),
      // Converters are recreated when a variable they watch changes, so their outputs change too.
      // Per the topic converter contract, outputs depend only on watched variables.
      variables: needed.flatMap(({ scriptData }) =>
        scriptData.globalVariables.map((name) => globalVariables[name]),
      ),
    };
    if (
      key.topics !== this.#convertedBlocksKey.topics ||
      !_.isEqual(key.variables, this.#convertedBlocksKey.variables) ||
      key.needed.length !== this.#convertedBlocksKey.needed.length ||
      key.needed.some((registration, i) => registration !== this.#convertedBlocksKey.needed[i])
    ) {
      this.#convertedBlocksKey = key;
      this.#convertedBlocks = new WeakMap();
      this.#deleteAlerts(TOPIC_CONVERTER_FAILED_ALERT_PREFIX);
      this.#lastMessageCache = undefined;
    }
    if (this.#lastMessageCache?.source === source) {
      return { ...progress, messageCache: this.#lastMessageCache.converted };
    }
    const context = { needed, sourceTopics, outputTopics, globalVariables };

    // A block whose conversion failed is cached with its partial result too, so it is not
    // converted again on every progress update.
    const convertBlock = async (block: MessageBlock): Promise<MessageBlock> => {
      const cached = this.#convertedBlocks.get(block);
      if (cached) {
        return cached;
      }
      const converted = await this.#convertBlock(block, context);
      if (!converted) {
        return block; // converted once its inputs finish loading (the block is replaced then)
      }
      this.#convertedBlocks.set(block, converted);
      return converted;
    };

    const blocks: (MessageBlock | undefined)[] = [];
    for (const block of source.blocks) {
      blocks.push(block ? await convertBlock(block) : undefined);
    }
    const previous = this.#lastMessageCache?.converted;
    // Keep the previous array when no block changed, so panels don't re-process allFrames.
    const converted: BlockCache =
      previous &&
      previous.startTime === source.startTime &&
      previous.blocks.length === blocks.length &&
      previous.blocks.every((block, i) => block === blocks[i])
        ? previous
        : { ...source, blocks };
    this.#lastMessageCache = { source, converted };
    return { ...progress, messageCache: converted };
  }

  /** Converts `block` with fresh converters; undefined while its inputs are still loading. */
  async #convertBlock(
    block: MessageBlock,
    { needed, sourceTopics, outputTopics, globalVariables }: BlockConversion,
  ): Promise<MessageBlock | undefined> {
    const loaded = sourceTopics.every(
      (topic) => block.messagesByTopic[topic] != undefined && block.needTopics?.has(topic) !== true,
    );
    if (!loaded) {
      return undefined;
    }
    const inputs = sourceTopics
      .flatMap((topic) => block.messagesByTopic[topic] ?? [])
      .sort(byReceiveTime);
    // Fresh converter instances per block: blocks load in any order, so state kept by a script
    // (e.g. a running sum) starts over at each block boundary.
    const outputs = await runFresh(inputs, needed, globalVariables);
    const messagesByTopic: Record<string, MessageEvent[]> = { ...block.messagesByTopic };
    let sizeInBytes = block.sizeInBytes;
    for (const topic of outputTopics) {
      messagesByTopic[topic] = [];
    }
    for (const output of outputs) {
      if (outputTopics.has(output.topic)) {
        messagesByTopic[output.topic]!.push(output);
        sizeInBytes += output.sizeInBytes;
      }
    }
    return { ...block, messagesByTopic, sizeInBytes };
  }

  #deleteAlerts(prefix: string): void {
    for (const key of this.#alertStore.keys()) {
      if (key.startsWith(prefix)) {
        this.#alertStore.delete(key);
      }
    }
  }

  async #getLib(
    state: ProtectedState,
    generator: MemoizedLibGenerator,
    setter: (lib: string) => void,
  ): Promise<string> {
    if (!state.lastPlayerStateActiveData) {
      throw new Error("getLib was called before `lastPlayerStateActiveData` set");
    }

    const { topics, datatypes } = state.lastPlayerStateActiveData;
    const { didUpdate, lib } = await generator.update({ topics, datatypes });
    if (didUpdate) {
      setter(lib);
    }

    return lib;
  }

  // invoked when our child player state changes
  async #onPlayerState(playerState: PlayerState) {
    try {
      const globalVariables = this.#globalVariables;
      const { activeData } = playerState;
      if (!activeData) {
        this.#playerState = playerState;
        await this.#queueEmitState();
        return;
      }

      const { messages, topics, datatypes } = activeData;

      // If we do not have active player data from a previous call, then our
      // player just spun up, meaning we should re-run our user scripts in case
      // they have inputs that now exist in the current player context.
      const newPlayerState = await this.#protectedState.runExclusive(async (state) => {
        if (!state.lastPlayerStateActiveData) {
          state.lastPlayerStateActiveData = activeData;
          await this.#resetWorkersUnlocked(state);
          this.#setSubscriptionsUnlocked(this.#subscriptions, state);
        } else {
          // Reset script state after seeking
          let shouldReset =
            activeData.lastSeekTime !== state.lastPlayerStateActiveData.lastSeekTime;

          // When topics or datatypes change we also need to re-build the scripts so we clear the cache
          if (
            activeData.topics !== state.lastPlayerStateActiveData.topics ||
            activeData.datatypes !== state.lastPlayerStateActiveData.datatypes
          ) {
            shouldReset = true;
            state.scriptRegistrationCache = [];
            this.#invalidateBatchIteratorCache();
          }

          state.lastPlayerStateActiveData = activeData;
          if (shouldReset) {
            await this.#resetWorkersUnlocked(state);
          }
        }

        const allDatatypes = this.#getDatatypes(datatypes, this.#memoizedScriptDatatypes);

        /**
         * if scripts have been updated we need to add their previous input messages
         * to our list of messages to be parsed so that subscribers can refresh with
         * the new output topic messages
         */
        const inputTopicsForRecompute = new Set<string>();

        for (const userScriptId of this.#userScriptIdsNeedUpdate) {
          const scriptRegistration = state.scriptRegistrations.find(
            ({ scriptId }) => scriptId === userScriptId,
          );
          if (!scriptRegistration) {
            continue;
          }
          const inputTopics = scriptRegistration.inputs;

          for (const topic of inputTopics) {
            inputTopicsForRecompute.add(topic);
          }
        }

        // remove topics that already have messages in state, because we won't need to take their last message to process
        // this also removes possible duplicate messages to be parsed
        for (const message of messages) {
          inputTopicsForRecompute.delete(message.topic);
        }

        const messagesForRecompute: MessageEvent[] = [];
        for (const topic of inputTopicsForRecompute) {
          const messageForRecompute = this.#lastMessageByInputTopic.get(topic);
          if (messageForRecompute) {
            messagesForRecompute.push(messageForRecompute);
          }
        }

        this.#userScriptIdsNeedUpdate.clear();

        for (const message of messages) {
          this.#lastMessageByInputTopic.set(message.topic, message);
        }

        // These are new messages generated from input messages
        const computed = await this.#getMessages(
          messages,
          globalVariables,
          state.scriptRegistrations,
        );

        // These are messages generated from previously saved messages on input topics
        const recomputed = await this.#getMessages(
          messagesForRecompute,
          globalVariables,
          state.scriptRegistrations,
        );

        // The current frame messages are the input messages + recomputed + computed sorted by
        // receive time. Reuse the input array when nothing was added and it is already sorted.
        const currentFrameMessages =
          recomputed.length === 0 && computed.length === 0 && isSortedByReceiveTime(messages)
            ? messages
            : messages
                .concat(recomputed)
                .concat(computed)
                .sort((a, b) => compare(a.receiveTime, b.receiveTime));

        return {
          ...playerState,
          progress: await this.#withConvertedBlocks(
            playerState.progress,
            state.scriptRegistrations,
          ),
          activeData: {
            ...activeData,
            messages: currentFrameMessages,
            topics: this.#getTopics(topics, this.#memoizedScriptTopics),
            datatypes: allDatatypes,
          },
        };
      });

      this.#playerState = newPlayerState;

      // clear any previous problem we had from making a new player state
      this.#alertStore.delete("player-state-update");
    } catch (e: unknown) {
      const err = toError(e);
      this.#alertStore.set("player-state-update", {
        severity: "error",
        message: err.message,
        error: err,
      });

      this.#playerState = playerState;
    } finally {
      await this.#queueEmitState();
    }
  }

  async #queueEmitState() {
    // Wrap in mutex in case the emitState triggered by changed script registrations happens
    // to run at the same time as an emitstate triggered by the underlying player.
    await this.#emitLock.runExclusive(async () => {
      if (!this.#playerState) {
        return;
      }

      // only augment child alerts if we have our own alerts
      // if neither child or parent have alerts we do nothing
      let alerts = this.#playerState.alerts;
      if (this.#alertStore.size > 0) {
        const merged = (alerts ?? []).concat(Array.from(this.#alertStore.values()));
        const last = this.#mergedAlerts;
        alerts =
          last?.length === merged.length && merged.every((alert, i) => alert === last[i])
            ? last
            : merged;
        this.#mergedAlerts = alerts;
      }

      const playerState: PlayerState = {
        ...this.#playerState,
        alerts,
      };

      if (this.#listener) {
        await this.#listener(playerState);
      }
    });
  }

  public setListener(listener: (_: PlayerState) => Promise<void>): void {
    this.#listener = listener;

    // Delay _player.setListener until our setListener is called because setListener in some cases
    // triggers initialization logic and remote requests. This is an unfortunate API behavior and
    // naming choice, but it's better for us not to do trigger this logic in the constructor.
    this.#player.setListener(async (state) => {
      await this.#onPlayerState(state);
    });
  }

  public setSubscriptions(subscriptions: SubscribePayload[], generation?: number): void {
    this.#subscriptions = subscriptions;
    this.#subscriptionGeneration = generation;
    this.#protectedState
      .runExclusive(async (state) => {
        this.#pruneLastMessages(
          state,
          this.#setSubscriptionsUnlocked(subscriptions, state, generation),
        );
      })
      .catch((err: unknown) => {
        log.error(err);
      });
  }

  /**
   * On a recording, drop the last messages of topics nobody subscribes to any more (they can be
   * large, e.g. an image), counting an alias and its source as one topic: subscribing again
   * backfills them. Like the message pipeline, a live source keeps them, since it never sends a
   * latched message again.
   */
  #pruneLastMessages(state: ProtectedState, subscriptions: Immutable<SubscribePayload[]>): void {
    if (!isRecordingSource(this.#playerState?.capabilities ?? [])) {
      return;
    }
    const aliasSources = this.#aliasSources(state.lastPlayerStateActiveData?.topics ?? []);
    const sourceTopic = (topic: string) => aliasSources.get(topic) ?? topic;
    const subscribed = new Set(subscriptions.map(({ topic }) => sourceTopic(topic)));
    for (const topic of this.#lastMessageByInputTopic.keys()) {
      if (!subscribed.has(sourceTopic(topic))) {
        this.#lastMessageByInputTopic.delete(topic);
      }
    }
  }

  #setSubscriptionsUnlocked(
    subscriptions: SubscribePayload[],
    state: ProtectedState,
    generation = this.#subscriptionGeneration,
  ): Immutable<SubscribePayload[]> {
    this.#scriptSubscriptions = getPreloadTypes(subscriptions);
    const remapped = remapVirtualSubscriptions(subscriptions, state.inputsByOutputTopic);
    this.#player.setSubscriptions(remapped, generation);
    return remapped;
  }

  public close = (): void => {
    void this.#protectedState.runExclusive(async (state) => {
      for (const scriptRegistration of state.scriptRegistrations) {
        scriptRegistration.terminate();
      }
    });
    this.#invalidateBatchIteratorCache();
    this.#runtimeWorkers.dispose();
    this.#player.close();
    if (this.#transformRpc) {
      void this.#transformRpc.close();
    }
  };

  public getMetadata(): ReadonlyArray<Readonly<Metadata>> {
    return this.#player.getMetadata?.() ?? Object.freeze([]);
  }

  public getInspectionIterator(
    topics: readonly string[],
    options?: { start?: Time; end?: Time },
  ): AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>> | undefined {
    if (topics.some((topic) => this.#outputTopicRegistrations.has(topic))) {
      return undefined;
    }
    return this.#player.getInspectionIterator?.(topics, options);
  }

  public getBatchIterator(
    topic: string,
    options?: { start?: Time; end?: Time },
  ): AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>> | undefined {
    const registration = this.#outputTopicRegistrations.get(topic);
    if (!registration) {
      return this.#player.getBatchIterator(topic, options);
    }

    return this.#getVirtualBatchIterator(registration, options);
  }

  // Topic converter outputs are backfilled by backfilling their inputs and running them through
  // fresh converter instances; the last output per requested topic is returned. User script
  // outputs are not backfilled (their processors report alerts and diagnostics as a side effect).
  public async getBackfillMessages(args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    const virtualTopics = this.#outputTopicRegistrations;
    const registrations = withDependencies(
      [...virtualTopics.values()].filter(isTopicConverter),
      args.topics.keys(),
    );
    const realTopics = new Map([...args.topics].filter(([topic]) => !virtualTopics.has(topic)));
    for (const { inputs } of registrations) {
      for (const input of inputs) {
        if (!virtualTopics.has(input) && !realTopics.has(input)) {
          realTopics.set(input, { topic: input });
        }
      }
    }
    if (realTopics.size === 0) {
      return [];
    }
    const backfill =
      (await this.#player.getBackfillMessages?.({ ...args, topics: realTopics })) ?? [];
    if (registrations.length === 0) {
      return backfill;
    }

    const outputs = await runFresh(
      [...backfill].sort(byReceiveTime),
      registrations,
      this.#globalVariables,
    );
    const lastOutputs = new Map<string, MessageEvent>();
    for (const output of outputs) {
      if (args.topics.has(output.topic)) {
        lastOutputs.set(output.topic, output);
      }
    }
    return [...backfill.filter(({ topic }) => args.topics.has(topic)), ...lastOutputs.values()];
  }

  #collectInputIterators(
    inputTopics: readonly string[],
    options?: { start?: Time; end?: Time },
  ): AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>>[] | undefined {
    const iterators: AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>>[] = [];
    for (const inputTopic of inputTopics) {
      // Through this player, so a topic converter can read another virtual topic.
      const iter = this.getBatchIterator(inputTopic, options);
      if (iter) {
        iterators.push(iter);
      }
    }
    return iterators.length > 0 ? iterators : undefined;
  }

  #getVirtualBatchIterator(
    registration: ScriptRegistration,
    options?: { start?: Time; end?: Time },
  ): AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>> | undefined {
    const inputTopics = registration.inputs;
    if (inputTopics.length === 0) {
      return undefined;
    }

    // For full-range (no options), use shared cache so multiple panels
    // subscribing to the same virtual topic only process messages once.
    if (!options) {
      const topic = registration.output.name;
      const existingCache = this.#batchIteratorCache.get(topic);
      if (existingCache?.pruneOffset === 0) {
        return this.#createReplayIterator(existingCache);
      }

      const inputIterators = this.#collectInputIterators(inputTopics);
      if (!inputIterators) {
        return undefined;
      }
      // The shared results were already dropped past their start: a late joiner gets its own
      // pipeline so it still sees the whole range.
      if (existingCache) {
        return this.#createIndependentIterator(registration, inputIterators);
      }
      const cache = this.#startSharedConsumer(topic, registration, inputIterators);
      this.#batchIteratorCache.set(topic, cache);
      return this.#createReplayIterator(cache);
    }

    // With range options, create an independent iterator (no cache)
    const inputIterators = this.#collectInputIterators(inputTopics, options);
    if (!inputIterators) {
      return undefined;
    }

    return this.#createIndependentIterator(registration, inputIterators);
  }

  /**
   * Merges multiple input iterators by receiveTime, processes each message through
   * the given processor, and yields transformed results. Handles cleanup of iterators
   * and processor on completion.
   */
  static async *#mergeAndTransformIterators(
    inputIterators: AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>>[],
    processor: { processMessages: ProcessMessages; terminate: () => void },
    globalVariables: GlobalVariables,
  ): AsyncGenerator<Readonly<IIterableSourceIteratorResult>> {
    const source =
      inputIterators.length === 1
        ? inputIterators[0]!
        : UserScriptPlayer.#mergeIteratorsByTime(inputIterators);

    // Messages go to the worker in batches: one round trip per batch instead of per message.
    let batch: MessageEvent[] = [];
    const flush = async () => {
      if (batch.length === 0) {
        return [];
      }
      const outputs = await processor.processMessages(batch, globalVariables);
      batch = [];
      return filterMap(outputs, (msgEvent) =>
        msgEvent ? { type: "message-event" as const, msgEvent } : undefined,
      );
    };

    try {
      for await (const result of source) {
        if (result.type === "message-event") {
          batch.push(result.msgEvent);
          if (batch.length < TRANSFORM_BATCH_SIZE) {
            continue;
          }
        }
        // Flush before yielding a non-message result so the order is kept.
        yield* await flush();
        if (result.type !== "message-event") {
          yield result;
        }
      }
      yield* await flush();
    } finally {
      for (const iter of inputIterators) {
        await iter.return?.();
      }
      processor.terminate();
    }
  }

  /**
   * Merges multiple async iterators into a single stream ordered by receiveTime.
   * Non-message-event results (e.g. stamps) are yielded before message events.
   */
  static async *#mergeIteratorsByTime(
    iterators: AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>>[],
  ): AsyncGenerator<Readonly<IIterableSourceIteratorResult>> {
    const heads: {
      iter: AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>>;
      current: Readonly<IIterableSourceIteratorResult>;
    }[] = [];

    for (const iter of iterators) {
      const next = await iter.next();
      if (next.done !== true) {
        heads.push({ iter, current: next.value });
      }
    }

    while (heads.length > 0) {
      const minIdx = UserScriptPlayer.#findEarliestHeadIndex(heads);
      const head = heads[minIdx]!;
      yield head.current;

      const next = await head.iter.next();
      if (next.done === true) {
        heads.splice(minIdx, 1);
      } else {
        head.current = next.value;
      }
    }
  }

  /**
   * Finds the index of the head with the earliest receiveTime.
   * Non-message-event results are treated as earlier than any message event.
   */
  static #findEarliestHeadIndex(
    heads: { current: Readonly<IIterableSourceIteratorResult> }[],
  ): number {
    let minIdx = 0;
    for (let i = 1; i < heads.length; i++) {
      const a = heads[minIdx]!.current;
      const b = heads[i]!.current;

      if (a.type !== "message-event") {
        continue; // a is non-message → already earliest priority
      }
      if (
        b.type !== "message-event" ||
        compare(b.msgEvent.receiveTime, a.msgEvent.receiveTime) < 0
      ) {
        minIdx = i; // b is non-message → takes priority
      }
    }
    return minIdx;
  }

  #startSharedConsumer(
    topic: string,
    registration: ScriptRegistration,
    inputIterators: AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>>[],
  ) {
    const processor = registration.buildMessageProcessor();
    const globalVariables = this.#globalVariables;

    const cache: BatchIteratorCacheEntry = {
      topic,
      results: new VecQueue(),
      done: false,
      error: undefined,
      ...Promise.withResolvers<void>(),
      processor,
      consumers: new Set(),
      pruneOffset: 0,
    };

    // Source consumer — processes messages once, populates shared results
    void (async () => {
      try {
        const source = UserScriptPlayer.#mergeAndTransformIterators(
          inputIterators,
          processor,
          globalVariables,
        );
        for await (const result of source) {
          // Backpressure: wait for the slowest consumer instead of buffering without bound.
          while (!cache.done && cache.results.size() >= MAX_GLOBAL_BUFFER_SIZE) {
            await cache.promise;
          }
          if (cache.done) {
            break;
          }
          cache.results.enqueue(result);
          UserScriptPlayer.#notify(cache);
        }
      } catch (err) {
        cache.error = toError(err);
      } finally {
        cache.done = true;
        UserScriptPlayer.#notify(cache);
      }
    })();

    return cache;
  }

  static #notify(cache: BatchIteratorCacheEntry): void {
    cache.resolve();
    ({ promise: cache.promise, resolve: cache.resolve } = Promise.withResolvers<void>());
  }

  #createReplayIterator(
    cache: BatchIteratorCacheEntry,
  ): AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>> {
    const consumer: CacheConsumerHandle = { index: cache.pruneOffset };
    cache.consumers.add(consumer);
    const gen = this.#replayIteratorImpl(cache, consumer);
    // A generator that is returned before its first next() never runs its finally block, so leave
    // the cache here too; otherwise the abandoned consumer would block the producer forever.
    const leave = () => {
      this.#leaveCache(cache, consumer);
    };
    return {
      next: async () => await gen.next(),
      return: async (value?: unknown) => {
        leave();
        return await gen.return(value);
      },
      throw: async (err?: unknown) => {
        leave();
        return await gen.throw(err);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  async *#replayIteratorImpl(
    cache: BatchIteratorCacheEntry,
    consumer: CacheConsumerHandle,
  ): AsyncGenerator<Readonly<IIterableSourceIteratorResult>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const result = cache.results.at(consumer.index - cache.pruneOffset);
        if (result) {
          consumer.index++;
          this.#pruneCache(cache);
          yield result;
        } else if (cache.done) {
          if (cache.error) {
            throw cache.error;
          }
          return;
        } else {
          await cache.promise;
        }
      }
    } finally {
      this.#leaveCache(cache, consumer);
    }
  }

  // Drop results every consumer has read and wake the producer.
  #pruneCache(cache: BatchIteratorCacheEntry) {
    let min = Infinity;
    for (const consumer of cache.consumers) {
      min = Math.min(min, consumer.index);
    }
    let pruned = false;
    while (cache.pruneOffset < min && cache.results.size() > 0) {
      cache.results.dequeue();
      cache.pruneOffset++;
      pruned = true;
    }
    if (pruned) {
      UserScriptPlayer.#notify(cache);
    }
  }

  #leaveCache(cache: BatchIteratorCacheEntry, consumer: CacheConsumerHandle) {
    if (!cache.consumers.delete(consumer)) {
      return;
    }
    if (cache.consumers.size === 0) {
      // Nobody reads it any more: stop the producer and free its results and worker.
      this.#stopCache(cache);
    } else {
      this.#pruneCache(cache);
    }
  }

  #stopCache(cache: BatchIteratorCacheEntry) {
    if (this.#batchIteratorCache.get(cache.topic) === cache) {
      this.#batchIteratorCache.delete(cache.topic);
    }
    cache.done = true;
    cache.results.clear();
    cache.processor.terminate();
    UserScriptPlayer.#notify(cache);
  }

  #createIndependentIterator(
    registration: ScriptRegistration,
    inputIterators: AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>>[],
  ): AsyncIterableIterator<Readonly<IIterableSourceIteratorResult>> {
    const processor = registration.buildMessageProcessor();
    return UserScriptPlayer.#mergeAndTransformIterators(
      inputIterators,
      processor,
      this.#globalVariables,
    );
  }

  public setPublishers(publishers: AdvertiseOptions[]): void {
    this.#player.setPublishers?.(publishers);
  }

  public setParameter(key: string, value: ParameterValue): void {
    this.#player.setParameter(key, value);
  }

  public publish(request: PublishPayload): void {
    this.#player.publish(request);
  }

  public async callService(service: string, request: unknown): Promise<unknown> {
    return await this.#player.callService(service, request);
  }

  public startPlayback(): void {
    this.#player.startPlayback?.();
  }

  public pausePlayback(): void {
    this.#player.pausePlayback?.();
  }

  public playUntil(time: Time): void {
    if (this.#player.playUntil) {
      this.#player.playUntil(time);
      return;
    }
    this.#player.seekPlayback?.(time);
  }

  public setPlaybackSpeed(speed: number): void {
    this.#player.setPlaybackSpeed?.(speed);
  }

  public seekPlayback(time: Time): void {
    this.#player.seekPlayback?.(time);
  }

  public setCompareOffsets(offsetsSec: readonly number[], request: number): void {
    this.#player.setCompareOffsets?.(offsetsSec, request);
  }

  public async exportLiveHistory(writable: IWritable): Promise<void> {
    await this.#player.exportLiveHistory?.(writable);
  }
}
