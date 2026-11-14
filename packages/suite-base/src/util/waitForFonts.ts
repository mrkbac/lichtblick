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
 * Wait for every custom font face (Inter and IBM Plex Mono, all weights) declared by CSS or the
 * FontFace API. Rendering text before fonts are loaded crashed the rendering thread for many
 * Windows users (a race in Chromium's DirectWrite font cache, see theme/src/typography.ts), so the
 * app must not render before this resolves. Start it early: the faces are separate files.
 */
export default async function waitForFonts(): Promise<unknown> {
  // allSettled: a face that fails to download (e.g. offline) falls back instead of blocking startup
  return await Promise.allSettled([...document.fonts].map(async (font) => await font.load()));
}
