// SPDX-License-Identifier: MPL-2.0

import { PROXY_ORIGINS, isLoopback } from "@lichtblick/suite-base/players/wsProxyOrigins";
import { toError } from "@lichtblick/suite-base/util/toError";

// Page half of the proxy extension's HTTP relay (chrome-extension/). Chrome blocks an https page
// from fetching a non-loopback http:// URL (mixed content); the extension's service worker can, so
// the request and its streamed response run over a MessagePort to the extension's content script.
// Workers can't reach the content script, so the main thread hands each one a channel port to it.

const FETCH_TYPE = "licht-http-proxy:fetch";
const CHANNEL_TYPE = "licht-http-proxy:channel";
const ATTACH_TIMEOUT_MS = 1000;
// Responses that must not have a body (Response() throws if given one)
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

type FromProxy =
  | { ev: "attached" }
  | { ev: "head"; status: number; statusText: string; headers: [string, string][] }
  | { ev: "chunk"; data: ArrayBuffer }
  | { ev: "end" }
  | { ev: "error"; message: string; missing?: boolean };

/** The extension isn't installed, doesn't run here, or was removed: fetch directly from now on. */
class ProxyMissingError extends Error {}

// Set once a request finds no extension. Direct fetches then still work when the user allowed
// insecure content for the site. Installing the extension needs a page reload, which resets this.
let extensionMissing = false;
// In a worker: the port to the content script that the main thread passed in
let workerChannel: MessagePort | undefined;

const pageOrigin = (): string | undefined =>
  typeof location === "undefined" ? undefined : location.origin;

/** True when this page can use the proxy and the browser would block the URL as mixed content. */
export function needsHttpProxy(url: string, origin: string | undefined = pageOrigin()): boolean {
  if (
    extensionMissing ||
    origin == undefined ||
    !origin.startsWith("https:") ||
    !PROXY_ORIGINS.has(origin) ||
    (typeof window === "undefined" && workerChannel == undefined)
  ) {
    return false;
  }
  const parsed = URL.parse(url, origin);
  return parsed?.protocol === "http:" && !isLoopback(parsed.hostname);
}

/**
 * For the main thread: a port a worker passes to `setHttpProxyChannel` so its fetches can use the
 * proxy, or undefined when none of `urls` needs it.
 */
export function openHttpProxyChannel(urls: readonly string[]): MessagePort | undefined {
  if (typeof window === "undefined" || !urls.some((url) => needsHttpProxy(url))) {
    return undefined;
  }
  const { port1, port2 } = new MessageChannel();
  // ponytail: the content script's end stays open after the worker ends; one idle port per open
  window.postMessage({ type: CHANNEL_TYPE }, window.location.origin, [port2]);
  return port1;
}

/** For a worker: use the port from `openHttpProxyChannel` for proxied fetches. */
export function setHttpProxyChannel(port: MessagePort | undefined): void {
  if (port != undefined) {
    workerChannel = port;
  }
}

/** fetch(), through the proxy extension when the browser would block the URL as mixed content. */
export async function proxiedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!needsHttpProxy(url)) {
    return await fetch(url, init);
  }
  try {
    return await proxyFetch(new URL(url, pageOrigin()).href, init);
  } catch (error) {
    if (error instanceof ProxyMissingError) {
      return await fetch(url, init);
    }
    throw error;
  }
}

async function proxyFetch(url: string, init: RequestInit): Promise<Response> {
  const { signal } = init;
  signal?.throwIfAborted();
  const { port1: port, port2 } = new MessageChannel();
  const request = {
    type: FETCH_TYPE,
    url,
    method: init.method ?? "GET",
    headers: [...new Headers(init.headers)],
    credentials: init.credentials,
  };
  if (workerChannel) {
    workerChannel.postMessage(request, [port2]);
  } else {
    window.postMessage(request, window.location.origin, [port2]);
  }

  return await new Promise<Response>((resolve, reject) => {
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const finish = () => {
      clearTimeout(attachTimeout);
      signal?.removeEventListener("abort", onAbort);
      port.close();
    };
    const fail = (error: Error) => {
      reject(error);
      body?.error(error);
      finish();
    };
    const onAbort = () => {
      port.postMessage({ cmd: "abort" });
      fail(toError(signal!.reason));
    };
    // No content script answered: the extension isn't installed or doesn't run on this origin
    const attachTimeout = setTimeout(() => {
      extensionMissing = true;
      fail(new ProxyMissingError("HTTP proxy extension unavailable"));
    }, ATTACH_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });

    port.onmessage = ({ data: msg }: MessageEvent<FromProxy>) => {
      switch (msg.ev) {
        case "attached":
          clearTimeout(attachTimeout);
          break;
        case "head": {
          const stream =
            NULL_BODY_STATUS.has(msg.status) || request.method === "HEAD"
              ? null
              : new ReadableStream<Uint8Array>({
                  start: (controller) => {
                    body = controller;
                  },
                  cancel: () => {
                    port.postMessage({ cmd: "abort" });
                    finish();
                  },
                });
          resolve(
            new Response(stream, {
              status: msg.status,
              statusText: msg.statusText,
              headers: msg.headers,
            }),
          );
          if (stream == undefined) {
            port.postMessage({ cmd: "abort" });
            finish();
          }
          break;
        }
        case "chunk":
          body?.enqueue(new Uint8Array(msg.data));
          break;
        case "end":
          body?.close();
          finish();
          break;
        case "error":
          if (msg.missing === true) {
            extensionMissing = true;
            fail(new ProxyMissingError(msg.message));
          } else {
            // Same type fetch() rejects with for network and CORS failures
            fail(new TypeError(msg.message));
          }
          break;
      }
    };
  });
}

/** Test hook: forget an earlier attach timeout and worker channel. */
export function resetHttpProxyForTests(): void {
  extensionMissing = false;
  workerChannel = undefined;
}
