// SPDX-License-Identifier: MPL-2.0

import "@ai-ecoverse/wasm-tailscale/wasm_exec.js";

import type { IPN } from "./ipnTypes";
import { openProfile, forgetProfile } from "./profile";
import { attachStream } from "./stream";

declare const TAILSCALE_WASM_ASSET: string;

export type SessionStatus = {
  state: string;
  // name is a dialable DNS name or IP; label is the optional display-only hostname.
  peers: { name: string; label?: string; online?: boolean }[];
  login?: string;
  error?: "tailscaleFailed" | "tailscaleStorageError";
};
type Command = "refreshPeers" | "start" | { port: MessagePort } | "release" | "logout";
const scope = self as unknown as SharedWorkerGlobalScope;
const clients = new Map<MessagePort, Set<AbortController>>();
let status: SessionStatus = { state: "Starting", peers: [] };
let started = false;
let signedOut = false;
let signingOut: Promise<void> | undefined;
let node: IPN | undefined;
let profile: Awaited<ReturnType<typeof openProfile>> | undefined;
let nodeState = "";
// Bumped on each (re)start; callbacks of a replaced Go runtime see a newer value and go quiet.
let generation = 0;

function abortStreams() {
  for (const streams of clients.values()) {
    for (const stream of streams) {
      stream.abort();
    }
  }
}

function update(change: Partial<SessionStatus>) {
  status = { ...status, ...change };
  // Pages fail their sockets on these states without telling the worker; free paused streams.
  if (status.state === "LoggedOut" || status.state === "NeedsLogin" || status.error) {
    abortStreams();
  }
  for (const client of clients.keys()) {
    client.postMessage(status);
  }
}

// Report Running only once the node's identity is saved; a later flush (Retry) clears the error.
function confirmRunning() {
  void profile?.flush().then(
    () => {
      if (!signedOut && nodeState === "Running") {
        update({ state: "Running", login: undefined, error: undefined });
      }
    },
    () => {
      update({ error: "tailscaleStorageError" });
    },
  );
}

function updatePeers(json: string, source: "netmap" | "status") {
  const map = JSON.parse(json) as {
    peers?: { name?: string; dnsName?: string; addresses?: string[]; online?: boolean }[];
  };
  const peers = (map.peers ?? []).flatMap((peer) => {
    // Net maps use name for DNS. In a status snapshot name is only the OS hostname.
    const dnsName = ((source === "netmap" ? peer.name : peer.dnsName) ?? "").replace(/\.$/, "");
    const name = dnsName || peer.addresses?.[0];
    const label = source === "status" && !dnsName ? peer.name : undefined;
    return name ? [{ name, label, online: peer.online }] : [];
  });
  update({ peers });
}

async function start() {
  const gen = ++generation;
  const stale = () => gen !== generation;
  try {
    profile = await openProfile();
  } catch {
    started = false; // let Retry try again once storage recovers
    update({ error: "tailscaleStorageError" });
    return;
  }
  const response = await fetch(new URL(TAILSCALE_WASM_ASSET, scope.location.href));
  if (!response.ok || !response.body) {
    throw new Error("Unable to load Tailscale");
  }
  const go = new Go();
  const wasm = await new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
  void go.run(instance).catch(() => {
    if (!stale()) {
      update({ error: "tailscaleFailed" });
    }
  });
  const ipn = newIPN({
    ephemeral: false,
    hostname: "lichtblick-web",
    logUpload: false,
    stateStorage: profile.storage,
  });
  if (ipn instanceof Error) {
    throw ipn;
  }
  node = ipn;
  ipn.run({
    notifyState: (state) => {
      if (stale()) {
        return;
      }
      nodeState = state;
      if (signedOut) {
        return;
      }
      if (state === "Running") {
        confirmRunning();
      } else {
        update({ state });
        if (state === "NeedsLogin") {
          ipn.login();
        }
      }
    },
    notifyNetMap: (json) => {
      if (signedOut || stale()) {
        return;
      }
      updatePeers(json, "netmap");
    },
    notifyBrowseToURL: (login) => {
      if (signedOut || stale()) {
        return;
      }
      if (new URL(login).origin === "https://login.tailscale.com") {
        update({ login });
      } else {
        update({ error: "tailscaleFailed" });
      }
    },
    notifyPanicRecover: () => {
      if (!stale()) {
        update({ error: "tailscaleFailed" });
      }
    },
  });
}

async function logout() {
  signedOut = true;
  abortStreams();
  node?.logout();
  if (profile) {
    await profile.clear();
  } else {
    await forgetProfile();
  }
  profile?.close();
  update({ state: "LoggedOut", peers: [], login: undefined, error: undefined });
  scope.close();
}

scope.onconnect = ({ ports }) => {
  const client = ports[0]!;
  const streams = new Set<AbortController>();
  clients.set(client, streams);
  function release() {
    clients.delete(client);
    for (const stream of streams) {
      stream.abort();
    }
    client.close();
    if (clients.size === 0) {
      // A tab may immediately reopen the dialog. Finish writes before retiring the idle node.
      // An in-flight sign-out must finish deleting the identity first.
      void Promise.resolve(signingOut ?? profile?.flush())
        .catch(() => {})
        .then(() => {
          if (clients.size === 0) {
            profile?.close();
            scope.close();
          }
        });
    }
  }
  client.addEventListener("close", release, { once: true });
  client.onmessage = ({ data }: MessageEvent<Command>) => {
    if (data === "release") {
      release();
    } else if (data === "logout") {
      // A failed identity deletion can be retried; streams stay closed via signedOut.
      signingOut ??= logout().catch(() => {
        signingOut = undefined;
        update({ error: "tailscaleStorageError" });
      });
    } else if (data === "refreshPeers") {
      if (status.state === "Running" && !signedOut) {
        const snapshot = node?.status();
        if (typeof snapshot === "string") {
          updatePeers(snapshot, "status");
        }
      }
    } else if (data === "start") {
      if (started && status.error === "tailscaleFailed" && !signedOut && !signingOut) {
        // The Go runtime exited or the node failed; nothing in it is reusable. Drop it and boot a
        // fresh one. ponytail: IPN has no stop(), so a node that only recovered a panic lingers
        // (its callbacks muted, its profile closed) until this worker retires.
        abortStreams();
        node = undefined;
        nodeState = "";
        profile?.close();
        profile = undefined;
        started = false;
      }
      if (started) {
        client.postMessage(status);
        if (node && status.error === "tailscaleStorageError") {
          confirmRunning();
        }
      } else {
        started = true;
        update({ error: undefined });
        void start().catch(() => {
          update({ error: "tailscaleFailed" });
          profile?.close();
          scope.close();
        });
      }
    } else if (node && !signedOut) {
      const abort = new AbortController();
      streams.add(abort);
      attachStream(node, data.port, abort, () => streams.delete(abort));
    } else {
      data.port.postMessage({
        type: "close",
        data: { code: 1008, reason: "Tailscale signed out", retryable: false },
      });
      data.port.close();
    }
  };
};
