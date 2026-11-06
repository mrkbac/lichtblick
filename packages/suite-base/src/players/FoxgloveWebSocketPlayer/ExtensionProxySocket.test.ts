// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { needsExtensionProxy } from "./ExtensionProxySocket";

describe("needsExtensionProxy", () => {
  it.each([
    ["ws://robot.example:8765", "https:", true],
    ["ws://10.0.0.5:8765", "https:", true],
    ["wss://robot.example:8765", "https:", false],
    ["ws://localhost:8765", "https:", false],
    ["ws://app.localhost:8765", "https:", false],
    ["ws://127.0.0.1:8765", "https:", false],
    ["ws://[::1]:8765", "https:", false],
    ["ws://robot.example:8765", "http:", false],
    ["ws://robot.example:8765", "file:", false],
    ["not a url", "https:", false],
  ])("%s from %s page → %s", (url, pageProtocol, expected) => {
    expect(needsExtensionProxy(url, pageProtocol)).toBe(expected);
  });
});
