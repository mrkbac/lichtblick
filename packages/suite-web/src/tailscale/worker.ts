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
let node: IPN | undefined;
let profile: Awaited<ReturnType<typeof openProfile>> | undefined;

function update(change: Partial<SessionStatus>) {
  status = { ...status, ...change };
  for (const client of clients.keys()) {
    client.postMessage(status);
  }
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
  try {
    profile = await openProfile();
  } catch {
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
    update({ error: "tailscaleFailed" });
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
  let latestState = "";
  ipn.run({
    notifyState: (state) => {
      latestState = state;
      if (signedOut) {
        return;
      }
      if (state === "Running") {
        void profile?.flush().then(
          () => {
            if (!signedOut && latestState === state) {
              update({ state, login: undefined });
            }
          },
          () => {
            update({ error: "tailscaleStorageError" });
          },
        );
      } else {
        update({ state });
        if (state === "NeedsLogin") {
          ipn.login();
        }
      }
    },
    notifyNetMap: (json) => {
      if (signedOut) {
        return;
      }
      updatePeers(json, "netmap");
    },
    notifyBrowseToURL: (login) => {
      if (signedOut) {
        return;
      }
      if (new URL(login).origin === "https://login.tailscale.com") {
        update({ login });
      } else {
        update({ error: "tailscaleFailed" });
      }
    },
    notifyPanicRecover: () => {
      update({ error: "tailscaleFailed" });
    },
  });
}

async function logout() {
  signedOut = true;
  for (const streams of clients.values()) {
    for (const stream of streams) {
      stream.abort();
    }
  }
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
      void Promise.resolve(profile?.flush())
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
      if (!signedOut) {
        void logout().catch(() => {
          update({ error: "tailscaleStorageError" });
        });
      }
    } else if (data === "refreshPeers") {
      if (status.state === "Running" && !signedOut) {
        const snapshot = node?.status();
        if (typeof snapshot === "string") {
          updatePeers(snapshot, "status");
        }
      }
    } else if (data === "start") {
      client.postMessage(status);
      if (!started) {
        started = true;
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
