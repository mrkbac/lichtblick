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
