// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from "node:crypto";
import { createServer, Socket } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

/** A Foxglove WebSocket server with one synthetic JSON topic, for live-connection tests. */
export type TestServer = {
  port: number;
  sessionId: string;
  /** Subscribe requests per connection, in connection order. */
  subscribesPerConnection: number[];
  close: () => Promise<void>;
};

export const TEST_TOPIC = "/test/counter";

/**
 * Publishes {@link TEST_TOPIC} at `hz` with `payloadBytes` of padding, stamped with wall time.
 * Publishes its clock, and advertises `assets` so the player can probe a silent link.
 */
export async function startTestServer(
  opts: { port?: number; sessionId?: string; hz?: number; payloadBytes?: number } = {},
): Promise<TestServer> {
  const { hz = 20, payloadBytes = 0 } = opts;
  const sessionId = opts.sessionId ?? randomUUID();
  const wss = new WebSocketServer({
    port: opts.port ?? 0,
    host: "127.0.0.1",
    handleProtocols: (protocols) => (protocols.has("foxglove.sdk.v1") ? "foxglove.sdk.v1" : false),
  });
  await new Promise((resolve) => wss.once("listening", resolve));
  const subscribesPerConnection: number[] = [];
  const subscriptions = new Map<WebSocket, Set<number>>();
  const padding = "x".repeat(payloadBytes);

  wss.on("connection", (ws) => {
    const index = subscribesPerConnection.push(0) - 1;
    const subs = new Set<number>();
    subscriptions.set(ws, subs);
    ws.on("close", () => subscriptions.delete(ws));
    ws.send(
      JSON.stringify({
        op: "serverInfo",
        name: "e2e test server",
        capabilities: ["assets", "time"],
        supportedEncodings: [],
        sessionId,
      }),
    );
    ws.send(
      JSON.stringify({
        op: "advertise",
        channels: [
          {
            id: 1,
            topic: TEST_TOPIC,
            encoding: "json",
            schemaName: "test.Counter",
            schemaEncoding: "jsonschema",
            schema: JSON.stringify({
              type: "object",
              properties: { n: { type: "number" }, pad: { type: "string" } },
            }),
          },
        ],
      }),
    );
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        return;
      }
      // Text frames arrive as one Buffer
      const msg = JSON.parse((data as Buffer).toString()) as {
        op: string;
        subscriptions?: { id: number }[];
        subscriptionIds?: number[];
        requestId?: number;
      };
      if (msg.op === "subscribe") {
        subscribesPerConnection[index]++;
        msg.subscriptions?.forEach(({ id }) => subs.add(id));
      } else if (msg.op === "unsubscribe") {
        msg.subscriptionIds?.forEach((id) => subs.delete(id));
      } else if (msg.op === "fetchAsset") {
        // op 4, requestId, status 1 (error), error length, error
        const error = Buffer.from("not found");
        const reply = Buffer.alloc(10 + error.length);
        reply.writeUInt8(4, 0);
        reply.writeUInt32LE(msg.requestId ?? 0, 1);
        reply.writeUInt8(1, 5);
        reply.writeUInt32LE(error.length, 6);
        error.copy(reply, 10);
        ws.send(reply);
      }
    });
  });

  let n = 0;
  const timer = setInterval(() => {
    const payload = Buffer.from(JSON.stringify({ n: n++, pad: padding }));
    const stamp = BigInt(Date.now()) * 1_000_000n;
    const time = Buffer.alloc(9);
    time.writeUInt8(2, 0); // op 2: time
    time.writeBigUInt64LE(stamp, 1);
    for (const client of wss.clients) {
      client.send(time);
      for (const subId of subscriptions.get(client) ?? []) {
        // op 1, subscription id, log time, payload
        const frame = Buffer.alloc(13 + payload.length);
        frame.writeUInt8(1, 0);
        frame.writeUInt32LE(subId, 1);
        frame.writeBigUInt64LE(stamp, 5);
        payload.copy(frame, 13);
        client.send(frame);
      }
    }
  }, 1000 / hz);

  return {
    port: (wss.address() as AddressInfo).port,
    sessionId,
    subscribesPerConnection,
    close: async () => {
      clearInterval(timer);
      wss.clients.forEach((client) => {
        client.terminate();
      });
      await new Promise((resolve) => {
        wss.close(resolve);
      });
    },
  };
}

/** A TCP proxy in front of the server that misbehaves like a bad mobile link. */
export type FaultProxy = {
  port: number;
  url: string;
  /** Delay each chunk by latency + random jitter, and cap throughput (0 = unlimited). */
  shape: (link: { latencyMs?: number; jitterMs?: number; kbps?: number }) => void;
  /** Cut every connection and refuse new ones for `ms`. */
  drop: (ms: number) => void;
  /**
   * Half-open link: open connections and new ones stay up but carry nothing. Connections caught by
   * it stay dead after {@link heal}, as they would after a real outage.
   */
  blackhole: () => void;
  heal: () => void;
  close: () => Promise<void>;
};

export async function startFaultProxy(targetPort: number): Promise<FaultProxy> {
  const link = { latencyMs: 0, jitterMs: 0, kbps: 0 };
  let refuseUntil = 0;
  let blackholed = false;
  const connections = new Set<{ client: Socket; upstream: Socket; dead: boolean }>();

  // Delivery after the link's latency and the time the bytes take at its bandwidth. One queue and
  // one timer per direction: timers of different delays don't fire in order, and TCP must.
  const pipe = (conn: { dead: boolean }, from: Socket, to: Socket) => {
    let linkFreeAt = 0;
    let lastDeliveryAt = 0;
    const queue: { at: number; chunk: Buffer }[] = [];
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      timer = undefined;
      const now = performance.now();
      while (queue.length > 0 && queue[0].at <= now) {
        const { chunk } = queue.shift()!;
        if (!conn.dead && !to.destroyed) {
          to.write(chunk);
        }
      }
      if (queue.length > 0) {
        timer = setTimeout(flush, queue[0].at - now);
      }
    };
    from.on("data", (chunk: Buffer) => {
      if (conn.dead) {
        return;
      }
      const now = performance.now();
      linkFreeAt = Math.max(linkFreeAt, now) + (link.kbps > 0 ? (chunk.length * 8) / link.kbps : 0);
      lastDeliveryAt = Math.max(
        lastDeliveryAt,
        linkFreeAt + link.latencyMs + Math.random() * link.jitterMs,
      );
      queue.push({ at: lastDeliveryAt, chunk });
      if (timer == undefined) {
        flush();
      }
    });
  };

  const server: Server = createServer((client) => {
    if (Date.now() < refuseUntil) {
      client.destroy();
      return;
    }
    const upstream = new Socket().connect(targetPort, "127.0.0.1");
    const conn = { client, upstream, dead: blackholed };
    connections.add(conn);
    const end = () => {
      connections.delete(conn);
      client.destroy();
      upstream.destroy();
    };
    for (const socket of [client, upstream]) {
      socket.setNoDelay(true);
      socket.on("error", end);
      // A dead link carries no FIN either
      socket.on("close", () => {
        if (!conn.dead) {
          end();
        }
      });
    }
    pipe(conn, client, upstream);
    pipe(conn, upstream, client);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    url: `ws://localhost:${port}`,
    shape: ({ latencyMs = 0, jitterMs = 0, kbps = 0 }) =>
      Object.assign(link, { latencyMs, jitterMs, kbps }),
    drop: (ms) => {
      refuseUntil = Date.now() + ms;
      for (const { client, upstream } of connections) {
        client.destroy();
        upstream.destroy();
      }
      connections.clear();
    },
    blackhole: () => {
      blackholed = true;
      connections.forEach((conn) => (conn.dead = true));
    },
    heal: () => {
      blackholed = false;
    },
    close: async () => {
      for (const { client, upstream } of connections) {
        client.destroy();
        upstream.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
