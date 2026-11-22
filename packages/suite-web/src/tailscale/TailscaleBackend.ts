// SPDX-License-Identifier: MPL-2.0

import type { LiveConnectionBackend } from "@lichtblick/suite-base/players/LiveConnectionBackend";
import WorkerMessageSocket from "@lichtblick/suite-base/players/WorkerMessageSocket";

import type { SessionStatus } from "./worker";

/** One client of the origin's shared Tailscale node. Each stream gets its own message channel. */
export class TailscaleBackend implements LiveConnectionBackend {
  readonly #worker = new SharedWorker(new URL("./worker", import.meta.url), {
    name: "lichtblick-tailscale",
  });
  #disposed = false;
  #failure?: string;
  #streams = new Set<WorkerMessageSocket>();
  public constructor(notify: (status: SessionStatus) => void) {
    const receive = (status: SessionStatus) => {
      if (status.state === "LoggedOut" || status.error || status.state === "NeedsLogin") {
        this.#failure =
          status.state === "LoggedOut"
            ? "Tailscale signed out"
            : "Tailscale connection unavailable";
        for (const socket of this.#streams) {
          socket.fail(this.#failure);
        }
      } else if (status.state === "Running") {
        this.#failure = undefined;
      }
      notify(status);
    };
    this.#worker.onerror = () => {
      receive({ state: "Failed", error: "tailscaleFailed", peers: [] });
    };
    this.#worker.port.onmessage = ({ data }: MessageEvent<SessionStatus>) => {
      receive(data);
    };
    this.#worker.port.postMessage("start");
    window.addEventListener("pagehide", this.#onPageHide);
  }
  public open(address: string, protocols: string[]): WorkerMessageSocket {
    const { port1, port2 } = new MessageChannel();
    if (this.#failure || this.#disposed) {
      port2.postMessage({
        type: "close",
        data: { code: 1008, reason: this.#failure ?? "Tailscale session closed", retryable: false },
      });
      port2.close();
    } else {
      this.#worker.port.postMessage({ port: port2 }, [port2]);
    }
    const socket = new WorkerMessageSocket(port1, address, protocols, () =>
      this.#streams.delete(socket),
    );
    this.#streams.add(socket);
    return socket;
  }
  public refreshPeers(): void {
    this.#worker.port.postMessage("refreshPeers");
  }
  public logout(): void {
    this.#worker.port.postMessage("logout");
  }
  #onPageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) {
      this.dispose();
    }
  };
  public dispose = (): void => {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    window.removeEventListener("pagehide", this.#onPageHide);
    this.#worker.port.onmessage = null;
    this.#worker.port.postMessage("release");
    this.#worker.port.close();
  };
}
