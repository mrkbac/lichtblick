// SPDX-License-Identifier: MPL-2.0

import type { IWebSocket } from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/protocol/protocol";

/** A live message transport. Each open creates a new ordered, bidirectional stream.
 * Backends adapt their framing and handshake to the player's socket-shaped interface.
 * A close event with retryable: false ends automatic reconnects; reason is shown to the user.
 * dispose releases the whole session after its last stream (including pending opens).
 */
export interface LiveConnectionBackend {
  open(address: string, protocols: string[]): IWebSocket;
  dispose?(): void;
}

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
/** A connection up this long counts as good: its drop starts the reconnect backoff over. */
export const STABLE_CONNECTION_MS = 30_000;

/**
 * Wait before reconnect attempt `attempt` (0 for the first after a drop): 1 s, doubling up to 15 s,
 * each cut by a random share of up to half, so clients that dropped together don't retry together.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
  return Math.round(ceiling * (1 - random() / 2));
}
