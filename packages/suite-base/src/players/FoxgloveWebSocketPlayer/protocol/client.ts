// SPDX-License-Identifier: MIT
//
// Client of the Foxglove WebSocket protocol. Vendored from @foxglove/ws-protocol 0.8.0 (see the
// license in protocol.ts) and reworked: typed handlers instead of an event emitter, a fast path
// for message data, batched subscriptions, the v1.1 schema table and playback state.

import {
  BinaryOpcode,
  Channel,
  ChannelId,
  ClientChannel,
  ClientChannelId,
  ClientChannelWithoutId,
  ClientJsonMessage,
  ConnectionGraphUpdate,
  FetchAssetResponse,
  IWebSocket,
  Parameter,
  ParameterValues,
  PlaybackControlRequest,
  PlaybackState,
  RemoveStatusMessages,
  ServerInfo,
  ServerJsonMessage,
  Service,
  ServiceCallFailure,
  ServiceCallPayload,
  ServiceCallResponse,
  ServiceId,
  StatusMessage,
  SubscriptionId,
  WireChannel,
  WireSchema,
  encodeClientMessageData,
  encodePlaybackControlRequest,
  encodeServiceCallRequest,
  parseBinaryMessage,
} from "./protocol";

/** Everything the server can send. Called synchronously from the socket's handlers. */
export type FoxgloveClientHandlers = {
  open: () => void;
  /** A socket error, or a message that couldn't be parsed */
  error: (error: Error) => void;
  close: (event: unknown) => void;
  serverInfo: (event: ServerInfo) => void;
  status: (event: StatusMessage) => void;
  removeStatus: (event: RemoveStatusMessages) => void;
  advertise: (channels: Channel[]) => void;
  unadvertise: (channelIds: ChannelId[]) => void;
  /** Hot path: no event object per message. `data` is a view into the received frame. */
  message: (subscriptionId: SubscriptionId, timestamp: bigint, data: Uint8Array) => void;
  time: (timestamp: bigint) => void;
  parameterValues: (event: ParameterValues) => void;
  advertiseServices: (services: Service[]) => void;
  unadvertiseServices: (serviceIds: ServiceId[]) => void;
  serviceCallResponse: (response: ServiceCallResponse) => void;
  serviceCallFailure: (failure: ServiceCallFailure) => void;
  connectionGraphUpdate: (event: ConnectionGraphUpdate) => void;
  fetchAssetResponse: (response: FetchAssetResponse) => void;
  playbackState: (state: PlaybackState) => void;
};

/**
 * A client of the Foxglove WebSocket protocol on `ws`, which must have been opened with one of
 * SUBPROTOCOLS. Unknown opcodes (from newer servers) are ignored.
 */
export class FoxgloveClient {
  #ws: IWebSocket;
  #handlers: FoxgloveClientHandlers;
  #nextSubscriptionId = 0;
  #nextAdvertisementId = 0;
  /** foxglove.sdk.v1.1: schemas sent once per connection, by id; cleared on each serverInfo */
  #schemasById = new Map<number, WireSchema>();
  #pendingSubscribe: { id: SubscriptionId; channelId: ChannelId }[] = [];
  #pendingUnsubscribe: SubscriptionId[] = [];
  #flushQueued = false;

  public constructor({ ws, handlers }: { ws: IWebSocket; handlers: FoxgloveClientHandlers }) {
    this.#ws = ws;
    this.#handlers = handlers;
    ws.binaryType = "arraybuffer";
    ws.onerror = (event: unknown) => {
      const error = (event as { error?: unknown } | undefined)?.error;
      handlers.error(error instanceof Error ? error : new Error("WebSocket error"));
    };
    ws.onopen = () => {
      handlers.open();
    };
    ws.onclose = (event: unknown) => {
      handlers.close(event);
    };
    ws.onmessage = ({ data }) => {
      if (typeof data === "string") {
        let message;
        try {
          message = JSON.parse(data) as ServerJsonMessage;
        } catch (error) {
          handlers.error(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        this.#handleJson(message);
      } else if (data instanceof ArrayBuffer) {
        this.#handleBinary(new Uint8Array(data));
      } else if (ArrayBuffer.isView(data)) {
        this.#handleBinary(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      }
    };
  }

  #handleBinary(bytes: Uint8Array): void {
    // Message data is nearly all traffic: read it without building a message object
    if (bytes[0] === BinaryOpcode.MESSAGE_DATA) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, 13);
      this.#handlers.message(
        view.getUint32(1, true),
        view.getBigUint64(5, true),
        bytes.subarray(13),
      );
      return;
    }
    let message;
    try {
      message = parseBinaryMessage(bytes);
    } catch (error) {
      // A truncated frame
      this.#handlers.error(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    switch (message?.op) {
      case BinaryOpcode.TIME:
        this.#handlers.time(message.timestamp);
        break;
      case BinaryOpcode.SERVICE_CALL_RESPONSE:
        this.#handlers.serviceCallResponse(message);
        break;
      case BinaryOpcode.FETCH_ASSET_RESPONSE:
        this.#handlers.fetchAssetResponse(message);
        break;
      case BinaryOpcode.PLAYBACK_STATE:
        this.#handlers.playbackState(message);
        break;
      case undefined:
        // A newer server's opcode: ignore it, as the protocol asks
        break;
    }
  }

  #handleJson(message: ServerJsonMessage): void {
    switch (message.op) {
      case "serverInfo":
        this.#schemasById.clear();
        this.#handlers.serverInfo(message);
        return;
      case "status":
        this.#handlers.status(message);
        return;
      case "removeStatus":
        this.#handlers.removeStatus(message);
        return;
      case "advertise":
        for (const schema of message.schemas ?? []) {
          this.#schemasById.set(schema.id, schema);
        }
        this.#handlers.advertise(message.channels.map((channel) => this.#resolveChannel(channel)));
        return;
      case "unadvertise":
        this.#handlers.unadvertise(message.channelIds);
        return;
      case "parameterValues":
        this.#handlers.parameterValues(message);
        return;
      case "advertiseServices":
        this.#handlers.advertiseServices(message.services);
        return;
      case "unadvertiseServices":
        this.#handlers.unadvertiseServices(message.serviceIds);
        return;
      case "connectionGraphUpdate":
        this.#handlers.connectionGraphUpdate(message);
        return;
      case "serviceCallFailure":
        this.#handlers.serviceCallFailure(message);
        return;
    }
    // A newer server's op: ignore it
  }

  /** The channel with its schema inline, whichever way the server sent it */
  #resolveChannel(channel: WireChannel): Channel {
    const { schemaId, ...rest } = channel;
    if (channel.schema != undefined || channel.schemaName != undefined) {
      return { ...rest, schemaName: channel.schemaName ?? "", schema: channel.schema ?? "" };
    }
    // An unknown schema id reads as no schema: the player reports channels that need one
    const schema = schemaId != undefined ? this.#schemasById.get(schemaId) : undefined;
    return schema
      ? { ...rest, schemaName: schema.name, schema: schema.data, schemaEncoding: schema.encoding }
      : { ...rest, schemaName: "", schema: "", schemaEncoding: "" };
  }

  public close(): void {
    this.#ws.close();
  }

  /** Subscriptions made in one task go out as one message */
  public subscribe(channelId: ChannelId): SubscriptionId {
    const id = this.#nextSubscriptionId++;
    this.#pendingSubscribe.push({ id, channelId });
    this.#queueFlush();
    return id;
  }

  public unsubscribe(subscriptionId: SubscriptionId): void {
    // Not sent yet: drop it instead of subscribing and unsubscribing
    const pending = this.#pendingSubscribe.findIndex(({ id }) => id === subscriptionId);
    if (pending !== -1) {
      this.#pendingSubscribe.splice(pending, 1);
      return;
    }
    this.#pendingUnsubscribe.push(subscriptionId);
    this.#queueFlush();
  }

  #queueFlush(): void {
    if (this.#flushQueued) {
      return;
    }
    this.#flushQueued = true;
    queueMicrotask(() => {
      this.#flushQueued = false;
      if (this.#pendingUnsubscribe.length > 0) {
        this.#send({ op: "unsubscribe", subscriptionIds: this.#pendingUnsubscribe });
        this.#pendingUnsubscribe = [];
      }
      if (this.#pendingSubscribe.length > 0) {
        this.#send({ op: "subscribe", subscriptions: this.#pendingSubscribe });
        this.#pendingSubscribe = [];
      }
    });
  }

  public advertise(clientChannel: ClientChannelWithoutId): ClientChannelId {
    const id = ++this.#nextAdvertisementId;
    const channels = [{ id, ...clientChannel } as ClientChannel];
    this.#send({ op: "advertise", channels });
    return id;
  }

  public unadvertise(channelId: ClientChannelId): void {
    this.#send({ op: "unadvertise", channelIds: [channelId] });
  }

  public getParameters(parameterNames: string[], id?: string): void {
    this.#send({ op: "getParameters", parameterNames, id });
  }

  public setParameters(parameters: Parameter[], id?: string): void {
    this.#send({ op: "setParameters", parameters, id });
  }

  public subscribeParameterUpdates(parameterNames: string[]): void {
    this.#send({ op: "subscribeParameterUpdates", parameterNames });
  }

  public unsubscribeParameterUpdates(parameterNames: string[]): void {
    this.#send({ op: "unsubscribeParameterUpdates", parameterNames });
  }

  public subscribeConnectionGraph(): void {
    this.#send({ op: "subscribeConnectionGraph" });
  }

  public unsubscribeConnectionGraph(): void {
    this.#send({ op: "unsubscribeConnectionGraph" });
  }

  public fetchAsset(uri: string, requestId: number): void {
    this.#send({ op: "fetchAsset", uri, requestId });
  }

  public sendMessage(channelId: ClientChannelId, data: Uint8Array): void {
    this.#ws.send(encodeClientMessageData(channelId, data));
  }

  public sendServiceCallRequest(request: ServiceCallPayload): void {
    this.#ws.send(encodeServiceCallRequest(request));
  }

  public sendPlaybackControlRequest(request: PlaybackControlRequest): void {
    this.#ws.send(encodePlaybackControlRequest(request));
  }

  #send(message: ClientJsonMessage): void {
    this.#ws.send(JSON.stringify(message));
  }
}
