// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Player implementations, loaded when a source opens so none of them weigh on startup. Calling a
 * loader early doubles as a prefetch: the import in `initialize` then resolves from cache.
 */

import type * as IterablePlayerModules from "@lichtblick/suite-base/dataSources/iterablePlayerModules";
import type FoxgloveWebSocketPlayer from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer";
import type Ros1Player from "@lichtblick/suite-base/players/Ros1Player";
import type RosbridgePlayer from "@lichtblick/suite-base/players/RosbridgePlayer";
import type VelodynePlayer from "@lichtblick/suite-base/players/VelodynePlayer";

export const loadIterablePlayer = async (): Promise<typeof IterablePlayerModules> =>
  await import("@lichtblick/suite-base/dataSources/iterablePlayerModules");

export const loadFoxgloveWebSocketPlayer = async (): Promise<typeof FoxgloveWebSocketPlayer> =>
  (await import("@lichtblick/suite-base/players/FoxgloveWebSocketPlayer")).default;

export const loadRosbridgePlayer = async (): Promise<typeof RosbridgePlayer> =>
  (await import("@lichtblick/suite-base/players/RosbridgePlayer")).default;

export const loadRos1Player = async (): Promise<typeof Ros1Player> =>
  (await import("@lichtblick/suite-base/players/Ros1Player")).default;

export const loadVelodynePlayer = async (): Promise<typeof VelodynePlayer> =>
  (await import("@lichtblick/suite-base/players/VelodynePlayer")).default;

/** Starts loading a player chunk without waiting for it; a failure surfaces on the real load. */
export function prefetch(load: () => Promise<unknown>): void {
  load().catch(() => {});
}
