// SPDX-License-Identifier: MIT
//
// Wire format of the Foxglove WebSocket protocol (subprotocols foxglove.websocket.v1,
// foxglove.sdk.v1 and foxglove.sdk.v1.1). Vendored from @foxglove/ws-protocol 0.8.0 and
// extended with what the Foxglove SDK added since (playback control, schema tables).
//
// Copyright (c) Foxglove Technologies Inc
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software
// and associated documentation files (the "Software"), to deal in the Software without
// restriction, including without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
// BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/** Offered newest first; the server picks the first it supports. */
export const SUBPROTOCOLS = ["foxglove.sdk.v1.1", "foxglove.sdk.v1", "foxglove.websocket.v1"];

export enum BinaryOpcode {
  MESSAGE_DATA = 1,
  TIME = 2,
  SERVICE_CALL_RESPONSE = 3,
  FETCH_ASSET_RESPONSE = 4,
  PLAYBACK_STATE = 5,
}

export enum ClientBinaryOpcode {
  MESSAGE_DATA = 1,
  SERVICE_CALL_REQUEST = 2,
  PLAYBACK_CONTROL_REQUEST = 3,
}

export enum StatusLevel {
  INFO = 0,
  WARNING = 1,
  ERROR = 2,
}

export enum ServerCapability {
  clientPublish = "clientPublish",
  time = "time",
  parameters = "parameters",
  parametersSubscribe = "parametersSubscribe",
  services = "services",
  connectionGraph = "connectionGraph",
  assets = "assets",
  playbackControl = "playbackControl",
}

export enum FetchAssetStatus {
  SUCCESS = 0,
  ERROR = 1,
}

export enum PlaybackStatus {
  Playing = 0,
  Paused = 1,
  Buffering = 2,
  Ended = 3,
}

export type ChannelId = number;
export type ClientChannelId = number;
export type SubscriptionId = number;
export type ServiceId = number;

/** A server channel with its schema resolved (inline, or from the v1.1 schema table). */
export type Channel = {
  id: ChannelId;
  topic: string;
  encoding: string;
  schemaName: string;
  /** Protocol-encoded schema data: text, or base64 for binary schema encodings */
  schema: string;
  /** "" for a channel without schema */
  schemaEncoding?: string;
  metadata?: Record<string, string>;
};

type ServiceMessageDefinition = {
  encoding: string;
  schemaName: string;
  schemaEncoding: string;
  schema: string;
};

export type Service = {
  id: ServiceId;
  name: string;
  type: string;
  /** Required unless the deprecated requestSchema is given */
  request?: ServiceMessageDefinition;
  /** Required unless the deprecated responseSchema is given */
  response?: ServiceMessageDefinition;
  /** @deprecated Use request; some bridges still only send this */
  requestSchema?: string;
  /** @deprecated Use response; some bridges still only send this */
  responseSchema?: string;
};

type ClientChannelSchemaInfo =
  | { schema: string; schemaEncoding: string }
  | { schema?: undefined; schemaEncoding?: undefined };
export type ClientChannel = {
  id: ClientChannelId;
  topic: string;
  encoding: string;
  schemaName: string;
} & ClientChannelSchemaInfo;
export type ClientChannelWithoutId = Omit<ClientChannel, "id">;

export type ParameterValue =
  | undefined
  | number
  | boolean
  | string
  | { [key: string]: ParameterValue }
  | ParameterValue[];
export type Parameter = {
  name: string;
  value: ParameterValue;
  type?: "byte_array" | "float64" | "float64_array";
};

export type ServiceCallPayload = {
  serviceId: ServiceId;
  callId: number;
  encoding: string;
  data: ArrayBufferView;
};

export type ServerInfo = {
  op: "serverInfo";
  name: string;
  capabilities: string[];
  supportedEncodings?: string[];
  metadata?: Record<string, string>;
  sessionId?: string;
  /** With the playbackControl capability: the range the server plays back, in ns */
  dataStartTime?: { sec: number; nsec: number };
  dataEndTime?: { sec: number; nsec: number };
};
export type StatusMessage = { op: "status"; level: StatusLevel; message: string; id?: string };
export type RemoveStatusMessages = { op: "removeStatus"; statusIds: string[] };
export type ParameterValues = { op: "parameterValues"; parameters: Parameter[]; id?: string };
export type ConnectionGraphUpdate = {
  op: "connectionGraphUpdate";
  publishedTopics: { name: string; publisherIds: string[] }[];
  subscribedTopics: { name: string; subscriberIds: string[] }[];
  advertisedServices: { name: string; providerIds: string[] }[];
  removedTopics: string[];
  removedServices: string[];
};
export type ServiceCallFailure = {
  op: "serviceCallFailure";
  serviceId: ServiceId;
  callId: number;
  message: string;
};
export type ServiceCallResponse = ServiceCallPayload;
export type FetchAssetResponse =
  | { requestId: number; status: FetchAssetStatus.SUCCESS; data: Uint8Array }
  | { requestId: number; status: FetchAssetStatus.ERROR; error: string };
export type PlaybackState = {
  status: PlaybackStatus;
  currentTimeNs: bigint;
  speed: number;
  didSeek: boolean;
  requestId: string;
};
export type PlaybackControlRequest = {
  play: boolean;
  speed: number;
  seekTimeNs?: bigint;
  requestId: string;
};

/** A channel as sent: schema inline (v1) or by id from the connection's schema table (v1.1) */
export type WireChannel = {
  id: ChannelId;
  topic: string;
  encoding: string;
  schemaName?: string;
  schema?: string;
  schemaEncoding?: string;
  schemaId?: number;
  metadata?: Record<string, string>;
};
export type WireSchema = { id: number; name: string; encoding: string; data: string };

/** JSON messages from the server, as received */
export type ServerJsonMessage =
  | ServerInfo
  | StatusMessage
  | RemoveStatusMessages
  | { op: "advertise"; channels: WireChannel[]; schemas?: WireSchema[] }
  | { op: "unadvertise"; channelIds: ChannelId[] }
  | { op: "advertiseServices"; services: Service[] }
  | { op: "unadvertiseServices"; serviceIds: ServiceId[] }
  | ParameterValues
  | ConnectionGraphUpdate
  | ServiceCallFailure;

/** JSON messages to the server */
export type ClientJsonMessage =
  | { op: "subscribe"; subscriptions: { id: SubscriptionId; channelId: ChannelId }[] }
  | { op: "unsubscribe"; subscriptionIds: SubscriptionId[] }
  | { op: "advertise"; channels: ClientChannel[] }
  | { op: "unadvertise"; channelIds: ClientChannelId[] }
  | { op: "getParameters"; parameterNames: string[]; id?: string }
  | { op: "setParameters"; parameters: Parameter[]; id?: string }
  | { op: "subscribeParameterUpdates"; parameterNames: string[] }
  | { op: "unsubscribeParameterUpdates"; parameterNames: string[] }
  | { op: "subscribeConnectionGraph" }
  | { op: "unsubscribeConnectionGraph" }
  | { op: "fetchAsset"; uri: string; requestId: number };

/** Socket the client runs on: a browser WebSocket or one of our proxies */
export interface IWebSocket {
  binaryType: string;
  protocol: string;
  onerror: ((event: unknown) => void) | null | undefined;
  onopen: ((event: unknown) => void) | null | undefined;
  onclose: ((event: unknown) => void) | null | undefined;
  onmessage: ((event: { data: unknown }) => void) | null | undefined;
  close(): void;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Binary server messages other than message data (see FoxgloveClient's fast path) */
export type BinaryServerMessage =
  | { op: BinaryOpcode.TIME; timestamp: bigint }
  | ({ op: BinaryOpcode.SERVICE_CALL_RESPONSE } & ServiceCallResponse)
  | ({ op: BinaryOpcode.FETCH_ASSET_RESPONSE } & FetchAssetResponse)
  | ({ op: BinaryOpcode.PLAYBACK_STATE } & PlaybackState);

/** Undefined for an opcode this client doesn't know: newer servers may send more. */
export function parseBinaryMessage(bytes: Uint8Array): BinaryServerMessage | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const op = view.getUint8(0);
  const string = (offset: number, length: number) =>
    textDecoder.decode(bytes.subarray(offset, offset + length));
  switch (op) {
    case BinaryOpcode.TIME:
      return { op, timestamp: view.getBigUint64(1, true) };
    case BinaryOpcode.SERVICE_CALL_RESPONSE: {
      const encodingLength = view.getUint32(9, true);
      return {
        op,
        serviceId: view.getUint32(1, true),
        callId: view.getUint32(5, true),
        encoding: string(13, encodingLength),
        data: bytes.subarray(13 + encodingLength),
      };
    }
    case BinaryOpcode.FETCH_ASSET_RESPONSE: {
      const requestId = view.getUint32(1, true);
      const status = view.getUint8(5);
      const errorLength = view.getUint32(6, true);
      if (status === FetchAssetStatus.SUCCESS) {
        return { op, requestId, status, data: bytes.subarray(10 + errorLength) };
      }
      return { op, requestId, status: FetchAssetStatus.ERROR, error: string(10, errorLength) };
    }
    case BinaryOpcode.PLAYBACK_STATE:
      return {
        op,
        status: view.getUint8(1),
        currentTimeNs: view.getBigUint64(2, true),
        speed: view.getFloat32(10, true),
        didSeek: view.getUint8(14) !== 0,
        requestId: string(19, view.getUint32(15, true)),
      };
  }
  return undefined;
}

export function encodeClientMessageData(channelId: ClientChannelId, data: Uint8Array): Uint8Array {
  const payload = new Uint8Array(5 + data.byteLength);
  const view = new DataView(payload.buffer);
  view.setUint8(0, ClientBinaryOpcode.MESSAGE_DATA);
  view.setUint32(1, channelId, true);
  payload.set(data, 5);
  return payload;
}

export function encodeServiceCallRequest(request: ServiceCallPayload): Uint8Array {
  const encoding = textEncoder.encode(request.encoding);
  const data = new Uint8Array(
    request.data.buffer,
    request.data.byteOffset,
    request.data.byteLength,
  );
  const payload = new Uint8Array(13 + encoding.byteLength + data.byteLength);
  const view = new DataView(payload.buffer);
  view.setUint8(0, ClientBinaryOpcode.SERVICE_CALL_REQUEST);
  view.setUint32(1, request.serviceId, true);
  view.setUint32(5, request.callId, true);
  // Bytes, not characters: a non-ASCII encoding name is longer in UTF-8
  view.setUint32(9, encoding.byteLength, true);
  payload.set(encoding, 13);
  payload.set(data, 13 + encoding.byteLength);
  return payload;
}

export function encodePlaybackControlRequest(request: PlaybackControlRequest): Uint8Array {
  const requestId = textEncoder.encode(request.requestId);
  const payload = new Uint8Array(19 + requestId.byteLength);
  const view = new DataView(payload.buffer);
  view.setUint8(0, ClientBinaryOpcode.PLAYBACK_CONTROL_REQUEST);
  view.setUint8(1, request.play ? 0 : 1);
  view.setFloat32(2, request.speed, true);
  view.setUint8(6, request.seekTimeNs == undefined ? 0 : 1);
  view.setBigUint64(7, request.seekTimeNs ?? 0n, true);
  view.setUint32(15, requestId.byteLength, true);
  payload.set(requestId, 19);
  return payload;
}
