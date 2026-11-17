// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { changeToEpochFormat } from "../../../fixtures/change-to-epoch-format";
import { test, expect } from "../../../fixtures/electron";
import { loadFiles } from "../../../fixtures/load-files";
import { PlayerControls } from "../../../page-objects";

const MCAP_FILENAME = "example.mcap";

/**
 * GIVEN a .mcap file is loaded
 * WHEN playback is started and then stopped with the given control
 * THEN the play icon changes each time
 * And playback time advances while playing and holds still once paused
 *
 * Start and stop share one test per control: each test launches the app and loads the file,
 * which takes most of its time.
 */
for (const { control, start, stop } of [
  {
    control: "Play button",
    start: async (player: PlayerControls) => {
      await player.play();
    },
    stop: async (player: PlayerControls) => {
      await player.pause();
    },
  },
  {
    control: "Spacebar key",
    start: async (player: PlayerControls) => {
      await player.togglePlayback();
    },
    stop: async (player: PlayerControls) => {
      await player.togglePlayback();
    },
  },
]) {
  test(`should start and stop playing when using the ${control}`, { tag: "@smoke" }, async ({
    mainWindow,
  }) => {
    const player = new PlayerControls(mainWindow);

    // Given
    await loadFiles({ mainWindow, filenames: MCAP_FILENAME });
    await changeToEpochFormat(mainWindow);
    const startTime = await player.getTimestampValue();

    // When playback starts
    await expect(player.getPlayButton()).toHaveAttribute("title", "Play");
    await start(player);

    // Then the time advances
    await expect(player.getPlayButton()).toHaveAttribute("title", "Pause");
    expect(await player.getTimestampValue()).toBeGreaterThan(startTime);

    // When playback stops
    await stop(player);

    // Then the time holds still
    await expect(player.getPlayButton()).toHaveAttribute("title", "Play");
    const pausedTime = await player.getTimestampValue();
    await mainWindow.waitForTimeout(1000);
    expect(await player.getTimestampValue()).toEqual(pausedTime);
  });
}
