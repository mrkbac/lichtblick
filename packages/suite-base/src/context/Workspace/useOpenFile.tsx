// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { enqueueSnackbar } from "notistack";
import { useCallback, useMemo } from "react";

import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { FILE_ACCEPT_TYPE } from "@lichtblick/suite-base/context/Workspace/constants";
import { normalizeExtensions } from "@lichtblick/suite-base/context/Workspace/utils";
import { extname } from "@lichtblick/suite-base/util/path";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";

export function useOpenFile(sources: readonly IDataSourceFactory[]): () => Promise<void> {
  const { selectSource } = usePlayerSelection();

  const throwErrorAndSnackbar: (message: string) => never = (message) => {
    enqueueSnackbar(message, { variant: "error" });
    throw new Error(message);
  };

  const normalizeExtensionsArray = useMemo(
    () => normalizeExtensions(sources.flatMap((source) => source.supportedFileTypes ?? [])),
    [sources],
  );

  return useCallback(async () => {
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
          extension: extname(file.name),
        };
      }),
    );

    const uniqueExtensions = new Set(processedFiles.map(({ extension }) => extension));
    // The first source for a type wins, as with drag and drop: built-in sources come before the
    // data loaders that extensions register. Mixed extensions are fine when that source reads all
    // of them (e.g. .csv and .tsv).
    const [extension] = uniqueExtensions;
    const source = sources.find(
      (s) =>
        s.type === "file" &&
        extension != undefined &&
        s.supportedFileTypes?.includes(extension) === true,
    );
    if (
      uniqueExtensions.size > 1 &&
      ![...uniqueExtensions].every((ext) => source?.supportedFileTypes?.includes(ext) === true)
    ) {
      throwErrorAndSnackbar(
        `Multiple file extensions detected: ${[...uniqueExtensions].join(
          ", ",
        )}. All files must have the same extension.`,
      );
    }

    if (source == undefined) {
      throwErrorAndSnackbar(`Cannot find a source to handle files with extension ${extension}`);
    }

    if (source.supportsMultiFile !== true && processedFiles.length > 1) {
      throwErrorAndSnackbar(`Opening multiple ${extension} files at once is not supported.`);
    }
    selectSource(source.id, { type: "file", handles: filesHandle });
  }, [normalizeExtensionsArray, selectSource, sources]);
}
