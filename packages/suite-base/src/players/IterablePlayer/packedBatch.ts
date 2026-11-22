// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { MessageEvent } from "@lichtblick/suite-base/players/types";

import type { IteratorResult } from "./IIterableSource";

/** Numbers stored per message in `PackedBatch.numbers` */
const STRIDE = 5;

/**
 * A batch of iterator results laid out for postMessage. Structured clone costs per object, so a
 * batch of message events as objects (each with two time objects) cost more to send than the
 * message bytes. Here each message costs one array entry and a few numbers in a typed array.
 */
export type PackedBatch<MessageType> = {
  /** Topic and schema name pairs, each listed once per batch */
  names: string[];
  /** Per message: index into `names` of its topic (its schema name follows) */
  nameIndexes: Uint32Array;
  /** Per message: receive sec, receive nsec, publish sec, publish nsec (NaN if none), size */
  numbers: Float64Array;
  messages: MessageType[];
  /** Results that are not plain message events, by their position in the batch */
  others: [position: number, result: IteratorResult<MessageType>][];
};

/** Packs `batch` and lists the buffers to transfer: the message bytes and the typed arrays. */
export function packBatch<MessageType>(batch: readonly IteratorResult<MessageType>[]): {
  packed: PackedBatch<MessageType>;
  transfer: Transferable[];
} {
  const names: string[] = [];
  // By topic, then schema name: a topic may alternate schemas (e.g. merged files)
  const nameIndexBySchemaByTopic = new Map<string, Map<string, number>>();
  // Sized for every result; the tail past the last message is unused
  const nameIndexes = new Uint32Array(batch.length);
  const numbers = new Float64Array(batch.length * STRIDE);
  const messages: MessageType[] = [];
  const others: PackedBatch<MessageType>["others"] = [];
  // A set: messages may share one backing buffer, and listing it twice makes postMessage throw
  const buffers = new Set<ArrayBufferLike>();

  for (let position = 0; position < batch.length; position++) {
    const result = batch[position]!;
    if (result.type !== "message-event" || !isPlain(result.msgEvent)) {
      others.push([position, result]);
      continue;
    }
    const { topic, schemaName, receiveTime, publishTime, message, sizeInBytes } = result.msgEvent;
    let bySchema = nameIndexBySchemaByTopic.get(topic);
    if (!bySchema) {
      nameIndexBySchemaByTopic.set(topic, (bySchema = new Map<string, number>()));
    }
    let nameIndex = bySchema.get(schemaName);
    if (nameIndex == undefined) {
      nameIndex = names.length;
      names.push(topic, schemaName);
      bySchema.set(schemaName, nameIndex);
    }
    const i = messages.length;
    const n = i * STRIDE;
    nameIndexes[i] = nameIndex;
    numbers[n] = receiveTime.sec;
    numbers[n + 1] = receiveTime.nsec;
    numbers[n + 2] = publishTime?.sec ?? NaN;
    numbers[n + 3] = publishTime?.nsec ?? NaN;
    numbers[n + 4] = sizeInBytes;
    messages.push(message);
    if (message instanceof Uint8Array) {
      buffers.add(message.buffer);
    }
  }

  const transfer = [...buffers, nameIndexes.buffer, numbers.buffer] as Transferable[];
  return { packed: { names, nameIndexes, numbers, messages, others }, transfer };
}

/** The batch `packBatch` packed, in its original order */
export function unpackBatch<MessageType>(
  packed: PackedBatch<MessageType>,
): IteratorResult<MessageType>[] {
  const { names, nameIndexes, numbers, messages, others } = packed;
  const batch: IteratorResult<MessageType>[] = [];
  let next = 0;
  for (const [position, result] of others) {
    while (batch.length < position) {
      batch.push(unpackMessage(next++));
    }
    batch.push(result);
  }
  while (next < messages.length) {
    batch.push(unpackMessage(next++));
  }
  return batch;

  function unpackMessage(i: number): IteratorResult<MessageType> {
    const nameIndex = nameIndexes[i]!;
    const n = i * STRIDE;
    const publishSec = numbers[n + 2]!;
    // One literal in the sources' field order, so every unpacked event has the same shape
    const msgEvent: MessageEvent<MessageType> = {
      topic: names[nameIndex]!,
      receiveTime: { sec: numbers[n]!, nsec: numbers[n + 1]! },
      publishTime: Number.isNaN(publishSec)
        ? undefined
        : { sec: publishSec, nsec: numbers[n + 3]! },
      message: messages[i]!,
      sizeInBytes: numbers[n + 4]!,
      schemaName: names[nameIndex + 1]!,
    };
    return { type: "message-event", msgEvent };
  }
}

/**
 * How packing treats each MessageEvent field: carried, or sent as an unpacked result when set.
 * Typed so that a new MessageEvent field fails to compile until it is listed here.
 */
const FIELDS = {
  topic: "packed",
  schemaName: "packed",
  receiveTime: "packed",
  publishTime: "packed",
  message: "packed",
  sizeInBytes: "packed",
  originalMessageEvent: "unpacked",
  topicConfig: "unpacked",
  serializedSizeInBytes: "unpacked",
} as const satisfies Record<keyof MessageEvent, "packed" | "unpacked">;

const UNPACKED_FIELDS = (Object.keys(FIELDS) as (keyof MessageEvent)[]).filter(
  (field) => FIELDS[field] === "unpacked",
);

/** True if packing keeps every field of `msgEvent` */
function isPlain(msgEvent: MessageEvent): boolean {
  for (const field of UNPACKED_FIELDS) {
    if (msgEvent[field] != undefined) {
      return false;
    }
  }
  return true;
}
