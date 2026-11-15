// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { McapRecoveryScanner, RecoveryLosses } from "@lichtblick/mcap-core";
import type { PlayerAlert } from "@lichtblick/suite-base/players/types";

/** What a recovery scan recovered and lost, for the user */
export function recoveryAlert(scanner: McapRecoveryScanner): PlayerAlert {
  const lost = describeLosses(scanner.losses());
  const recovered = describeRecovered(scanner);
  if (lost.length > 0) {
    return damagedAlert(scanner, lost);
  }
  return scanner.complete
    ? {
        severity: "info",
        message: "This file has no index; it was rebuilt in memory.",
        tip: `${recovered}.`,
      }
    : {
        severity: "warn",
        message: "This file was not closed properly (no footer); recovered all of its records.",
        tip: `${recovered}.`,
      };
}

/**
 * For a file still being written: what was lost, if anything, ignoring the cut-off end (the part
 * not written yet).
 */
export function liveRecoveryAlerts(scanner: McapRecoveryScanner): PlayerAlert[] {
  const lost = describeLosses(scanner.losses({ live: true }));
  return lost.length > 0 ? [damagedAlert(scanner, lost)] : [];
}

function describeRecovered(scanner: McapRecoveryScanner): string {
  const chunks = scanner.recoveredChunkCount();
  return chunks > 0
    ? `Recovered ${scanner.messageCount} message(s) from ${chunks} chunk(s)`
    : `Recovered ${scanner.unchunkedMessageCount} message(s)`;
}

function damagedAlert(scanner: McapRecoveryScanner, lost: string[]): PlayerAlert {
  return {
    severity: "warn",
    message: "This file is damaged; showing what could be recovered.",
    tip: `${describeRecovered(scanner)}; ${lost.join("; ")}.`,
  };
}

function describeLosses({
  corruptRecords,
  unreadableBytes,
  skippedMessages,
}: RecoveryLosses): string[] {
  const lost: string[] = [];
  if (corruptRecords > 0) {
    lost.push(`${corruptRecords} corrupt record(s) (e.g. chunks with a bad CRC) were skipped`);
  }
  if (unreadableBytes > 0n) {
    lost.push(
      `the last ${formatBytes(unreadableBytes)} could not be read (cut off or not MCAP data)`,
    );
  }
  if (skippedMessages > 0) {
    lost.push(`${skippedMessages} message(s) outside chunks were skipped`);
  }
  return lost;
}

function formatBytes(bytes: bigint): string {
  const n = Number(bytes);
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1024 / 1024).toFixed(1)} MiB`;
}
