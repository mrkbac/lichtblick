// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { colord } from "colord";
import { NativeImage, nativeImage } from "electron";
import path from "path";

const ROTATION_DEGREES = 270;

/** The regular app icon with a hue shift for development mode. */
export default function getDevModeIcon(): NativeImage | undefined {
  try {
    // This can fail when opening the app from a packaged DMG.
    const originalIcon = nativeImage.createFromPath(
      path.resolve(__dirname, "..", require.resolve("./index"), "../../../resources/icon/icon.png"),
    );

    const buffer = originalIcon.toBitmap();
    for (let i = 0; i + 3 < buffer.length; i += 4) {
      ({
        r: buffer[i],
        g: buffer[i + 1],
        b: buffer[i + 2],
      } = colord({ r: buffer[i]!, g: buffer[i + 1]!, b: buffer[i + 2]! })
        .rotate(ROTATION_DEGREES)
        .toRgb());
    }

    return nativeImage.createFromBuffer(buffer, originalIcon.getSize());
  } catch (error) {
    console.error("Unable to create dev mode icon", error);
    return undefined;
  }
}
