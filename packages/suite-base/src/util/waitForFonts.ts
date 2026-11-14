// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

/**
 * Wait for the regular Inter and IBM Plex Mono faces before the first render. Rendering before
 * fonts are loaded crashed the rendering thread for many Windows users (skia/DirectWrite font
 * loading with display scaling >100%), so the app must not render text before these are ready.
 *
 * Only the regular faces are awaited: the other weights and italics (each a separate file) load on
 * first use instead of delaying startup.
 */
export default async function waitForFonts(): Promise<unknown> {
  return await Promise.all([
    document.fonts.load('400 1em "Inter"'),
    document.fonts.load('400 1em "IBM Plex Mono"'),
  ]);
}
