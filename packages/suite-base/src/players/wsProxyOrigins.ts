// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Origins the WebSocket proxy extension's content script runs on (`chrome-extension/manifest.json`). */
export const PROXY_ORIGINS: ReadonlySet<string> = new Set(["https://licht.marko.im"]);
