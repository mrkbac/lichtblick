// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@foxglove/comlink";

import { abortSignalTransferHandler } from "@lichtblick/comlink-transfer-handlers";
import { Immutable, MessageEvent } from "@lichtblick/suite";

import { ComlinkTransferIteratorCursor } from "./ComlinkTransferIteratorCursor";
import type {
  GetBackfillMessagesArgs,
  IIterableSource,
  IMessageCursor,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";
import { IteratorCursor } from "./IteratorCursor";

/**
 * Worker-side half of WorkerIterableSource. Serialized (Uint8Array) message buffers are
 * transferred to the main thread instead of being structured-cloned.
 */
export class WorkerIterableSourceWorker<MessageType = unknown>
  implements IIterableSource<MessageType>
{
  #source: IIterableSource<MessageType>;

  public constructor(source: IIterableSource<MessageType>) {
    this.#source = source;
  }

  public async initialize(): Promise<Initialization> {
    return await this.#source.initialize();
  }

  public async waitForUpdate(): Promise<Initialization | undefined> {
    return await this.#source.waitForUpdate?.();
  }

  public async setCompareOffsets(offsetsSec: readonly number[]): Promise<void> {
    await this.#source.setCompareOffsets?.(offsetsSec);
  }

  public messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<MessageType>>> & Comlink.ProxyMarked {
    return Comlink.proxy(this.#source.messageIterator(args));
  }

  public async getBackfillMessages(
    args: Omit<GetBackfillMessagesArgs, "abortSignal">,
    // abortSignal is a separate argument so it can be proxied by comlink since AbortSignal is not
    // clonable (and needs to signal across the worker boundary)
    abortSignal?: AbortSignal,
  ): Promise<MessageEvent<MessageType>[]> {
    const messages = await this.#source.getBackfillMessages({
      ...args,
      abortSignal,
    });
    // Messages may share one backing buffer; listing it twice makes postMessage throw
    const buffers = new Set<ArrayBufferLike>();
    for (const msg of messages) {
      if (msg.message instanceof Uint8Array) {
        buffers.add(msg.message.buffer);
      }
    }
    return Comlink.transfer(messages, [...buffers] as Transferable[]);
  }

  public getMessageCursor(
    args: Omit<Immutable<MessageIteratorArgs>, "abort">,
    abort?: AbortSignal,
  ): IMessageCursor<MessageType> & Comlink.ProxyMarked {
    const iter = this.#source.messageIterator(args);
    const cursor = new ComlinkTransferIteratorCursor(new IteratorCursor<MessageType>(iter, abort));
    return Comlink.proxy(cursor);
  }

  public async terminate(): Promise<void> {
    await this.#source.terminate?.();
  }
}

Comlink.transferHandlers.set("abortsignal", abortSignalTransferHandler);
