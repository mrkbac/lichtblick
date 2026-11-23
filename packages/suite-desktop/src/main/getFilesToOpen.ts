// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as path from "path";

import { pushAll } from "@lichtblick/den/collection";

import { isFileToOpen } from "./fileUtils";
import { parseCLIFlags } from "./parseCLIFlags";
import { resolveSourcePaths } from "./resolveSourcePaths";

/** Files named in `argv`; relative paths resolve against `cwd`, the launching process's directory. */
export const getFilesToOpen = (argv: string[], cwd = process.cwd()): string[] => {
  // Get the command line flags passed to the app when it was launched
  const parsedCLIFlags = parseCLIFlags(argv);

  const filesToOpen: string[] = argv
    .slice(1)
    .filter((arg) => !arg.startsWith("--")) // Filter out flags
    .map((filePath) => path.resolve(cwd, filePath)) // Convert to absolute path, linux has some problems to resolve relative paths
    .filter(isFileToOpen);

  // Get file paths passed through the parameter "--source="
  const filesToOpenFromSourceParameter = resolveSourcePaths(parsedCLIFlags.source, cwd);

  pushAll(filesToOpen, filesToOpenFromSourceParameter);

  const uniqueFilesToOpen = [...new Set(filesToOpen)];

  return uniqueFilesToOpen.filter(isFileToOpen);
};
