// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { loadIterablePlayer } from "@lichtblick/suite-base/dataSources/playerModules";
import { createMcapSourceWorker } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/createMcapSourceWorker";
import { Player } from "@lichtblick/suite-base/players/types";
import { remoteCompareNames } from "@lichtblick/suite-base/util/compareSides";
import { extname } from "@lichtblick/suite-base/util/path";
import { urlsOf } from "@lichtblick/suite-base/util/recentSources";

const initWorkers: Record<string, () => Worker> = {
  ".bag": () => {
    return new Worker(
      new URL(
        "@lichtblick/suite-base/players/IterablePlayer/BagIterableSourceWorker.worker",
        import.meta.url,
      ),
    );
  },
  ".mcap": createMcapSourceWorker,
};

const fileTypesAllowed: AllowedFileExtensions[] = [
  AllowedFileExtensions.BAG,
  AllowedFileExtensions.MCAP,
];

function parseCompareOffsets(value: string | undefined, sideCount: number): number[] | undefined {
  if (value == undefined || sideCount < 2) {
    return undefined;
  }
  const entries = value.split(",");
  if (entries.length !== sideCount || entries.some((entry) => entry.trim() === "")) {
    return undefined;
  }
  const offsets = entries.map(Number);
  return offsets.every((offset) => Number.isSafeInteger(Math.round(offset * 1e9)))
    ? offsets
    : undefined;
}

class RemoteDataSourceFactory implements IDataSourceFactory {
  public id = "remote-file";

  // The remote file feature use to be handled by two separate factories with these IDs.
  // We consolidated this into one factory that appears in the "connection" list and has a `url` field.
  //
  // To keep backwards compatability with deep-link urls that used these ids we provide them as legacy aliases
  public legacyIds = ["mcap-remote-file", "ros1-remote-bagfile"];

  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Remote file";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public supportedFileTypes = fileTypesAllowed;

  public formConfig = {
    fields: [
      {
        id: "url",
        label: "Remote file URL",
        placeholder: "https://example.com/file.bag",
        validate: (newValue: string): Error | undefined => {
          return this.#validateUrl(newValue);
        },
      },
    ],
  };

  public prefetch = loadIterablePlayer;

  public async initialize(args: DataSourceFactoryInitializeArgs): Promise<Player | undefined> {
    const { IterablePlayer, WorkerSerializedIterableSource, expandVideoSeekBackfill } =
      await loadIterablePlayer();
    const urls = urlsOf(args);
    if (urls.length === 0) {
      return;
    }
    const params = args.params ?? {};
    // Same meaning as Foxglove's `ds.includeCredentials`: send cookies with the file requests
    const includeCredentials = params.includeCredentials === "true";
    const credentials: RequestCredentials | undefined = includeCredentials ? "include" : undefined;

    let nextExtension: string | undefined = undefined;
    let extension = "";

    urls.forEach((url) => {
      extension = extname(new URL(url).pathname).toLowerCase();
      nextExtension = this.checkExtensionMatch(extension, nextExtension);
    });

    const initWorker = initWorkers[extension];
    if (initWorker == undefined) {
      throw new Error(
        `${extension === "" ? "Files without an extension" : `${extension} files`} can't be opened from a URL yet. Open .bag or .mcap files from a URL, or open the file from disk.`,
      );
    }

    // `ds.compare=true` compares the files side by side, one side per file; a comma list names the
    // side of each file instead (files with the same name are merged into that side).
    // `ds.compareNames` is that list with commas in names escaped (see encodeCompareNames).
    const { compare: compareParam, compareNames } = params;
    const compare = remoteCompareNames(urls, params);
    const compareOffsets =
      compare == undefined
        ? undefined
        : parseCompareOffsets(params.compareOffsets, new Set(compare).size);

    const initArgs =
      urls.length === 1
        ? { url: urls[0], credentials }
        : {
            urls: [...urls],
            credentials,
            compare,
            ...(compareOffsets != undefined && { compareOffsets }),
          };
    const source = new WorkerSerializedIterableSource({ initWorker, initArgs });

    return new IterablePlayer({
      source,
      // A catalog passes the recording's name, so the title bar shows it instead of the URL
      name: params.name ?? urls.join(),
      // Keep includeCredentials in the app URL so reloads and shared links still send cookies
      urlParams: {
        urls: [...urls],
        ...(includeCredentials && { includeCredentials: "true" }),
        ...(params.name != undefined && { name: params.name }),
        ...(compareOffsets != undefined && { compareOffsets: compareOffsets.join() }),
        ...(compare && (compareNames != undefined ? { compareNames } : { compare: compareParam! })),
      },
      sourceId: this.id,
      readAheadDuration: { sec: 10, nsec: 0 },
      // MCAP can carry foxglove.CompressedVideo. Some codecs (e.g. H.265) cannot decode a P/B-frame
      // in isolation, so on a backward seek the backfill is expanded to include the preceding GOP.
      // A no-op for non-video (e.g. .bag) sources.
      expandBackfill: expandVideoSeekBackfill,
    });
  }

  private checkExtensionMatch(fileExtension: string, previousExtension?: string): string {
    if (previousExtension != undefined && previousExtension !== fileExtension) {
      throw new Error("All sources need to be from the same type");
    }
    return fileExtension;
  }

  #validateUrl(newValue: string): Error | undefined {
    try {
      const url = new URL(newValue);
      const extension = extname(url.pathname).toLowerCase() as AllowedFileExtensions;

      if (extension.length === 0) {
        return new Error("URL must end with a filename and extension");
      }

      if (!this.supportedFileTypes.includes(extension)) {
        const supportedExtensions = new Intl.ListFormat("en-US", { style: "long" }).format(
          this.supportedFileTypes,
        );
        return new Error(`Only ${supportedExtensions} files are supported.`);
      }

      return undefined;
    } catch (err: unknown) {
      console.error(err);
      return new Error("Enter a valid url");
    }
  }
}

export default RemoteDataSourceFactory;
