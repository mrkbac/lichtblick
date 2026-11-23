// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";
import * as _ from "lodash-es";

import { MutexLocked } from "@lichtblick/den/async";
import type { IWritable } from "@lichtblick/mcap-core";
import { Immutable, Metadata, MessageEvent, ParameterValue } from "@lichtblick/suite";
import { Asset } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import {
  AdvertiseOptions,
  Player,
  PlayerState,
  PublishPayload,
  SubscribePayload,
} from "@lichtblick/suite-base/players/types";

import type { AliasingStateProcessor } from "./AliasingStateProcessor";
import {
  StateFactoryInput,
  StateProcessorFactory,
  TopicAliasFunctions,
} from "./StateProcessorFactory";
import { GetBackfillMessagesArgs, IteratorResult } from "../IterablePlayer/IIterableSource";

export type { TopicAliasFunctions };

/**
 * This is a player that wraps an underlying player and applies aliases to all topic names
 * in data emitted from the player.
 *
 * Aliases that alias input topics to other input topics or that request conflicting
 * aliases from multiple input topics to the same output topic are disallowed and flagged
 * as player alerts
 */
export class TopicAliasingPlayer implements Player {
  readonly #player: Player;

  #inputs: Immutable<StateFactoryInput>;
  #aliasedSubscriptions: undefined | SubscribePayload[];
  #subscriptions: SubscribePayload[] = [];

  // True if no aliases are active and we can pass calls directly through to the
  // underlying player.
  #skipAliasing: boolean;

  #stateProcessorFactory: StateProcessorFactory = new StateProcessorFactory();
  // Undefined when nothing is aliased: state and subscriptions pass through unchanged
  #stateProcessor: AliasingStateProcessor | undefined;

  #lastPlayerState?: PlayerState;
  #reemitQueued = false;

  // We only want to be emitting one state at a time however we also queue emits from global
  // variable updates which can happen at a different time to new state from the wrapped player. The
  // mutex prevents invoking the listener concurrently.
  #listener?: MutexLocked<(state: PlayerState) => Promise<void>>;

  public constructor(player: Player) {
    this.#player = player;
    this.#skipAliasing = true;
    this.#inputs = {
      aliasFunctions: [],
      topics: undefined,
      variables: {},
    };
  }

  public getMetadata(): ReadonlyArray<Readonly<Metadata>> {
    return this.#player.getMetadata?.() ?? Object.freeze([]);
  }

  public getInspectionIterator(
    topics: readonly string[],
    options?: { start?: Time; end?: Time },
  ): AsyncIterableIterator<Readonly<IteratorResult>> | undefined {
    return this.#player.getInspectionIterator?.(topics, options);
  }

  public getBatchIterator(
    topic: string,
    options?: { start?: Time; end?: Time },
  ): AsyncIterableIterator<Readonly<IteratorResult>> | undefined {
    return this.#player.getBatchIterator(topic, options);
  }

  // No alias translation, matching getBatchIterator above — these unstable/advanced APIs
  // operate on raw underlying topic names.
  public async getBackfillMessages(args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    return (await this.#player.getBackfillMessages?.(args)) ?? [];
  }

  public setListener(listener: (playerState: PlayerState) => Promise<void>): void {
    this.#listener = new MutexLocked(listener);

    this.#player.setListener(async (state) => {
      await this.#onPlayerState(state);
    });
  }

  public setAliasFunctions(aliasFunctions: Immutable<TopicAliasFunctions>): void {
    this.#inputs = { ...this.#inputs, aliasFunctions };
    this.#skipAliasing = aliasFunctions.length === 0;
    this.#reprocessLastState();
  }

  public close(): void {
    this.#player.close();
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    this.#subscriptions = subscriptions;
    this.#aliasedSubscriptions =
      this.#stateProcessor?.aliasSubscriptions(subscriptions) ?? subscriptions;
    this.#player.setSubscriptions(this.#aliasedSubscriptions);
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

  public startPlayback?(): void {
    this.#player.startPlayback?.();
  }

  public pausePlayback?(): void {
    this.#player.pausePlayback?.();
  }

  public seekPlayback?(time: Time): void {
    this.#player.seekPlayback?.(time);
  }

  public setCompareOffsets(offsetsSec: readonly number[], request: number): void {
    this.#player.setCompareOffsets?.(offsetsSec, request);
  }

  public async exportLiveHistory(writable: IWritable): Promise<void> {
    await this.#player.exportLiveHistory?.(writable);
  }

  public playUntil?(time: Time): void {
    if (this.#player.playUntil) {
      this.#player.playUntil(time);
      return;
    }
    this.#player.seekPlayback?.(time);
  }

  public setPlaybackSpeed?(speedFraction: number): void {
    this.#player.setPlaybackSpeed?.(speedFraction);
  }

  public setGlobalVariables(globalVariables: GlobalVariables): void {
    this.#player.setGlobalVariables?.(globalVariables);

    this.#inputs = { ...this.#inputs, variables: globalVariables };
    this.#reprocessLastState();
  }

  public async fetchAsset(uri: string): Promise<Asset> {
    if (this.#player.fetchAsset) {
      return await this.#player.fetchAsset(uri);
    }
    throw Error("Player does not support fetching assets");
  }

  async #onPlayerState(playerState: PlayerState) {
    // States from the wrapped player are never dropped: the mutex queues them behind an emit
    // already in progress.
    await this.#listener?.runExclusive(async (listener) => {
      // Remember the last player state so we can re-process it when the alias inputs change
      this.#lastPlayerState = playerState;

      // Player topics are an input to the alias functions, so new topics re-build the aliases
      if (playerState.activeData?.topics !== this.#inputs.topics) {
        this.#inputs = { ...this.#inputs, topics: playerState.activeData?.topics };
        this.#updateStateProcessor();
      }

      await listener(this.#process(playerState));
    });
  }

  #process(playerState: PlayerState): PlayerState {
    return this.#stateProcessor?.process(playerState, this.#subscriptions) ?? playerState;
  }

  /**
   * Build the state processor for the current inputs. When it changes, re-alias the subscriptions.
   * @returns whether the processor changed
   */
  #updateStateProcessor(): boolean {
    // Alias functions need the player's topics, so nothing is aliased before the first state
    const stateProcessor =
      this.#skipAliasing || this.#inputs.topics == undefined
        ? undefined
        : this.#stateProcessorFactory.buildStateProcessor(this.#inputs);
    if (stateProcessor === this.#stateProcessor) {
      return false;
    }
    this.#stateProcessor = stateProcessor;
    this.#resetSubscriptions();
    return true;
  }

  /**
   * Apply changed alias functions or global variables to the last player state, so panels see the
   * new aliased topics and messages.
   *
   * Skipped while playing: the player's next state picks up the new aliases, and an extra emit
   * would interfere with playback. It assumes a playing player emits state quickly.
   */
  #reprocessLastState(): void {
    if (!this.#updateStateProcessor() || this.#lastPlayerState?.activeData?.isPlaying !== false) {
      return;
    }
    // Coalesce: one queued re-emit of the latest state covers any number of input changes
    if (this.#reemitQueued || !this.#listener) {
      return;
    }
    this.#reemitQueued = true;
    void this.#listener.runExclusive(async (listener) => {
      this.#reemitQueued = false;
      if (this.#lastPlayerState) {
        await listener(this.#process(this.#lastPlayerState));
      }
    });
  }

  /**
   * Re-calculate the subscriptions using the latest state processor. If the subscriptions have
   * changed then call setSubscriptions on the wrapped player.
   */
  #resetSubscriptions() {
    const aliasedSubscriptions =
      this.#stateProcessor?.aliasSubscriptions(this.#subscriptions) ?? this.#subscriptions;
    if (!_.isEqual(this.#aliasedSubscriptions, aliasedSubscriptions)) {
      this.#aliasedSubscriptions = aliasedSubscriptions;
      this.#player.setSubscriptions(aliasedSubscriptions);
    }
  }
}
