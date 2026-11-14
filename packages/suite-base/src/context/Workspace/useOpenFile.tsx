// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { enqueueSnackbar } from "notistack";
import path from "path";
import { useCallback, useMemo } from "react";

import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { FILE_ACCEPT_TYPE } from "@lichtblick/suite-base/context/Workspace/constants";
import { normalizeExtensions } from "@lichtblick/suite-base/context/Workspace/utils";
import { defaultCompareSides } from "@lichtblick/suite-base/util/compareSides";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";

export type OpenFileOptions = {
  /** Compare the picked recordings side by side instead of merging them */
  compare?: boolean;
};

export function useOpenFile(
  sources: readonly IDataSourceFactory[],
): (options?: OpenFileOptions) => Promise<void> {
  const { selectSource } = usePlayerSelection();

  const throwErrorAndSnackbar = (message: string): void => {
    enqueueSnackbar(message, { variant: "error" });
    throw new Error(message);
  };

  const allExtensions = useMemo(() => {
    return sources.reduce<string[]>((all, source) => {
      if (!source.supportedFileTypes) {
        return all;
      }

      return [...all, ...source.supportedFileTypes];
    }, []);
  }, [sources]);

  const normalizeExtensionsArray = useMemo(
    () => normalizeExtensions(allExtensions),
    [allExtensions],
  );

  return useCallback(
    async (options?: OpenFileOptions) => {
      const filesHandle = await showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: normalizeExtensionsArray.join(", "),
            accept: {
              [FILE_ACCEPT_TYPE]: normalizeExtensionsArray,
            },
          },
        ],
      });
      if (filesHandle.length === 0) {
        return;
      }

      const processedFiles = await Promise.all(
        filesHandle.map(async (handle) => {
          const file = await handle.getFile();
          return {
            file,
            extension: path.extname(file.name),
          };
        }),
      );

      const uniqueExtensions = new Set(processedFiles.map(({ extension }) => extension));
      const sourcesFor = (ext: string | undefined) =>
        sources.filter(
          (source) =>
            source.type === "file" &&
            ext != undefined &&
            source.supportedFileTypes?.includes(ext) === true,
        );
      // Mixed extensions are fine when one source reads all of them (e.g. .csv and .tsv)
      const [firstSource, ...otherSources] = sourcesFor([...uniqueExtensions][0]);
      const oneSourceReadsAll =
        firstSource != undefined &&
        otherSources.length === 0 &&
        [...uniqueExtensions].every(
          (ext) => firstSource.supportedFileTypes?.includes(ext) === true,
        );
      if (uniqueExtensions.size > 1 && !oneSourceReadsAll) {
        throwErrorAndSnackbar(
          `Multiple file extensions detected: ${[...uniqueExtensions].join(
            ", ",
          )}. All files must have the same extension.`,
        );
      }

      const [extension] = uniqueExtensions;
      const matchingSources = sourcesFor(extension);

      if (matchingSources.length === 0) {
        throwErrorAndSnackbar(`Cannot find a source to handle files with extension ${extension}`);
      }

      if (matchingSources.length > 1) {
        throwErrorAndSnackbar(
          `The file extension "${extension}" is not supported. Please select files with the following extensions: ${allExtensions.join(", ")}.`,
        );
      }

      if (matchingSources[0]!.supportsMultiFile !== true && processedFiles.length > 1) {
        throwErrorAndSnackbar(`Opening multiple ${extension} files at once is not supported.`);
      }
      if (
        options?.compare === true &&
        matchingSources[0]!.supportsCompare !== true &&
        processedFiles.length > 1
      ) {
        throwErrorAndSnackbar(`Comparing ${extension} files side by side is not supported.`);
      }
      selectSource(matchingSources[0]!.id, {
        type: "file",
        handles: filesHandle,
        compare:
          options?.compare === true
            ? defaultCompareSides(processedFiles.map(({ file }) => file))
            : undefined,
      });
    },
    [allExtensions, normalizeExtensionsArray, selectSource, sources],
  );
}
