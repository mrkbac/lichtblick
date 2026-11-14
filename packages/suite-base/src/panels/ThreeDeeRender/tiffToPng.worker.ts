// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { decodeTiffToPng } from "./tiffToPng";

self.onmessage = async ({ data }: MessageEvent<Uint8Array>) => {
  try {
    self.postMessage(await decodeTiffToPng(data));
  } catch (error) {
    self.postMessage(error instanceof Error ? error : new Error(String(error)));
  }
};
