// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type JSZip from "jszip";

export default async function decompressFile(foxeFileData: Uint8Array): Promise<JSZip> {
  // Loaded on first use: jszip (~95 KB) would otherwise sit in the startup bundle.
  const { default: JSZipImpl } = await import("jszip");
  return await new JSZipImpl().loadAsync(foxeFileData);
}
