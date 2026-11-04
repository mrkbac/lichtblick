// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, fromNanoSec, isLessThan, isGreaterThan } from "@foxglove/rostime";
import { McapStreamReader, McapTypes } from "@mcap/core";

import { TopicInfo, FileInfo } from "./types";

type McapInfo = {
  totalMessages: bigint;
  numChunks: number;
  numAttachments: number;
  startTime: Time | undefined;
  endTime: Time | undefined;
  compressionTypes: Set<string>;
  topicInfosByTopic: Map<string, TopicInfo & { connectionIds: Set<number> }>;
  topicNamesByChannelId: Map<number, string>;
  schemaNamesById: Map<number, string>;
};

function processMcapRecord(info: McapInfo, record: McapTypes.TypedMcapRecord): void {
  switch (record.type) {
    case "Chunk":
      info.numChunks++;
      info.compressionTypes.add(record.compression);
      return;

    case "Attachment":
      info.numAttachments++;
      break;

    case "Schema":
      info.schemaNamesById.set(record.id, record.name);
      break;

    case "Channel": {
      info.topicNamesByChannelId.set(record.id, record.topic);
      const chanInfo = info.topicInfosByTopic.get(record.topic);
      const schemaName = info.schemaNamesById.get(record.schemaId);
      if (chanInfo != undefined) {
        if (schemaName != undefined && chanInfo.schemaName !== schemaName) {
          chanInfo.schemaName = "(multiple)";
        }
        if (!chanInfo.connectionIds.has(record.id)) {
          chanInfo.connectionIds.add(record.id);
          chanInfo.numConnections++;
        }
      } else {
        info.topicInfosByTopic.set(record.topic, {
          topic: record.topic,
          schemaName: schemaName ?? "(unknown)",
          numMessages: 0n,
          numConnections: 1,
          connectionIds: new Set([record.id]),
        });
      }
      return;
    }

    case "Message": {
      const topic = info.topicNamesByChannelId.get(record.channelId);
      if (topic != undefined) {
        const topicInfo = info.topicInfosByTopic.get(topic);
        if (topicInfo != undefined) {
          topicInfo.numMessages = (topicInfo.numMessages ?? 0n) + 1n;
        }
      }
      info.totalMessages++;
      const timestamp = fromNanoSec(record.logTime);
      if (!info.startTime || isLessThan(timestamp, info.startTime)) {
        info.startTime = timestamp;
      }
      if (!info.endTime || isGreaterThan(timestamp, info.endTime)) {
        info.endTime = timestamp;
      }
      return;
    }

    case "AttachmentIndex":
    case "Statistics":
    case "Unknown":
    case "Header":
    case "Footer":
    case "MessageIndex":
    case "ChunkIndex":
    case "Metadata":
    case "MetadataIndex":
    case "SummaryOffset":
    case "DataEnd":
      break;
  }
}

export default async function getStreamedMcapInfo(
  file: Blob,
  decompressHandlers: McapTypes.DecompressHandlers,
  fileType: string,
  reportProgress: (progress: number) => void,
): Promise<FileInfo> {
  const mcapStreamReader = new McapStreamReader({
    includeChunks: true,
    decompressHandlers,
    validateCrcs: true,
  });
  const info: McapInfo = {
    totalMessages: 0n,
    numChunks: 0,
    numAttachments: 0,
    startTime: undefined,
    endTime: undefined,
    compressionTypes: new Set(),
    topicInfosByTopic: new Map(),
    topicNamesByChannelId: new Map(),
    schemaNamesById: new Map(),
  };

  // Use file.slice() rather than file.stream().getReader().read() because the latter has terrible
  // performance in Safari (~50x slower than Chrome).
  const chunkSize = 1024 * 1024;
  let bytesRead = 0;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const buffer = await file.slice(offset, offset + chunkSize).arrayBuffer();
    mcapStreamReader.append(new Uint8Array(buffer));
    for (let record; (record = mcapStreamReader.nextRecord()) != undefined; ) {
      processMcapRecord(info, record);
    }
    bytesRead += buffer.byteLength;
    reportProgress(bytesRead / file.size);
  }

  const topics = [...info.topicInfosByTopic.values()].sort((a, b) =>
    a.topic.localeCompare(b.topic),
  );
  return { ...info, fileType, topics };
}
