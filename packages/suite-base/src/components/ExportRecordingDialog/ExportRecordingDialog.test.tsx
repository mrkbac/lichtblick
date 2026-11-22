/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, waitFor } from "@testing-library/react";

import { ExportRecordingDialog } from "./ExportRecordingDialog";
import { ExportReadable } from "./exportRecording";

function pendingReadable(): ExportReadable & { close: ReturnType<typeof vi.fn> } {
  return {
    size: async () => 1000n,
    // A read that never finishes, like an index scan over a slow connection
    read: async () => await new Promise<Uint8Array>(() => {}),
    close: vi.fn(),
  };
}

describe("ExportRecordingDialog", () => {
  it("closes the readable when dismissed while it is still opening", async () => {
    const readable = pendingReadable();
    const open = vi.fn(async () => readable);
    const { unmount } = render(
      <ExportRecordingDialog source={{ name: "a.mcap", open }} onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
    unmount();
    expect(readable.close).toHaveBeenCalled();
  });

  it("closes the readable when the file can't be opened", async () => {
    const readable: ExportReadable & { close: ReturnType<typeof vi.fn> } = {
      size: async () => 4n,
      read: async () => new Uint8Array([1, 2, 3, 4]),
      close: vi.fn(),
    };
    render(
      <ExportRecordingDialog
        source={{ name: "a.mcap", open: async () => readable }}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(readable.close).toHaveBeenCalled();
    });
  });
});
