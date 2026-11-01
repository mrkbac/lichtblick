// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageDefinition } from "@foxglove/message-definition";
import { MessageWriter as Ros1MessageWriter } from "@foxglove/rosmsg-serialization";
import { MessageWriter as Ros2MessageWriter } from "@foxglove/rosmsg2-serialization";
import { Channel, ClientChannel, Service } from "@foxglove/ws-protocol";

import { ParsedChannel } from "@lichtblick/mcap-support";

export type ResolvedChannel = {
  channel: Channel;
  parsedChannel: ParsedChannel;
};
export type Publication = ClientChannel & { messageWriter?: Ros1MessageWriter | Ros2MessageWriter };
export type ResolvedService = {
  service: Service;
  parsedResponse: ParsedChannel;
  requestMessageWriter: MessageWriter;
};
export type MessageDefinitionMap = Map<string, MessageDefinition>;
export type FromWorkerMessage =
  | { type: "open"; protocol: string }
  | { type: "close"; data: unknown }
  | { type: "error"; error: unknown }
  | { type: "message"; data: unknown };

export type ToWorkerMessage =
  | { type: "open"; data: { wsUrl: string; protocols?: string[] | string } }
  | { type: "close"; data: undefined }
  | { type: "data"; data: string | ArrayBuffer | ArrayBufferView };

export interface MessageWriter {
  writeMessage(message: unknown): Uint8Array;
}
