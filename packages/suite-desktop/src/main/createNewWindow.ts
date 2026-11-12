// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import Logger from "@lichtblick/log";

import StudioWindow from "./StudioWindow";
import { getDeepLinks, toLichtblickDeepLink } from "./deepLinks";
import { isFileToOpen } from "./fileUtils";
import { getFilesToOpen } from "./getFilesToOpen";
import injectFilesToOpen from "./injectFilesToOpen";
import { opensFoxgloveLinks } from "./settings";

const log = Logger.getLogger(__filename);

export const createNewWindow = (argv: string[]): void => {
  const options = { acceptFoxglove: opensFoxgloveLinks() };
  const deepLinks = getDeepLinks(argv.slice(1), options);

  const files = argv
    .slice(1)
    .filter((arg) => !arg.startsWith("--")) // Filter out flags
    .filter((arg) => toLichtblickDeepLink(arg, options) == undefined) // Filter out deep links
    .filter((arg) => isFileToOpen(arg));

  log.debug("Files extracted from second instance:", files);

  const newWindow = new StudioWindow(deepLinks);

  const filesToOpen = getFilesToOpen(argv);

  // Wait for the window to be ready before injecting files
  newWindow.getBrowserWindow().webContents.once("did-finish-load", async () => {
    if (filesToOpen.length > 0) {
      log.debug("Injecting files into new window:", filesToOpen);
      await injectFilesToOpen(newWindow.getBrowserWindow().webContents.debugger, filesToOpen);
    }
  });

  newWindow.load();
};
