// SPDX-License-Identifier: MPL-2.0

import type {
  DataSourceArgs,
  IDataSourceFactory,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { basename, extname } from "@lichtblick/suite-base/util/path";

/** A recording to open or compare: a local file, or the URL of a remote one */
export type Recording = File | string;

function urlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** File name of a recording, e.g. `drive.mcap` for `https://example.com/runs/drive.mcap?x=1` */
export function recordingName(recording: Recording): string {
  if (typeof recording !== "string") {
    return recording.name;
  }
  const name = basename(urlPath(recording));
  try {
    return decodeURIComponent(name) || recording;
  } catch {
    // A literal `%` that isn't an escape
    return name || recording;
  }
}

/** Extension of a recording's file name, e.g. `.mcap` */
export function recordingExtension(recording: Recording): string {
  return extname(typeof recording === "string" ? urlPath(recording) : recording.name);
}

// The folder each opened file came from, for files that don't carry it in webkitRelativePath
// (e.g. files read from a dropped folder)
const folderOfFile = new WeakMap<Blob, string>();

export function rememberFolder(file: Blob, folder: string): void {
  folderOfFile.set(file, folder);
}

function folderOf(file: Recording): string | undefined {
  if (typeof file === "string") {
    return undefined;
  }
  const known = folderOfFile.get(file);
  if (known != undefined) {
    return known;
  }
  const parts = file.webkitRelativePath.split("/");
  return parts.length > 1 ? parts[0] : undefined;
}

/**
 * The `ds.compareNames` value for side names: joined by commas, with commas (and `%`) in a name
 * escaped so names keep them. A new param rather than `ds.compare`, whose older plain lists keep
 * meaning what they did (e.g. `%41` stays `%41`).
 */
export function encodeCompareNames(names: readonly string[]): string {
  return names.map((name) => name.replaceAll("%", "%25").replaceAll(",", "%2C")).join(",");
}

/**
 * The side names in a remote source's params: `compareNames` (see encodeCompareNames), else the
 * plain `compare` list. `compare=true` (one side per file) names none.
 */
function compareNamesOf(
  params: Record<string, string | undefined> | undefined,
): string[] | undefined {
  if (params?.compareNames != undefined) {
    return params.compareNames.split(",").map((name) => {
      try {
        return decodeURIComponent(name);
      } catch {
        return name;
      }
    });
  }
  const plain = params?.compare;
  return plain == undefined || plain === "" || plain === "true" ? undefined : plain.split(",");
}

export function remoteCompareNames(
  urls: readonly string[],
  params: Record<string, string | undefined> | undefined,
): string[] | undefined {
  if (urls.length < 2) {
    return undefined;
  }
  const names =
    compareNamesOf(params) ??
    (params?.compare === "true"
      ? uniqueNames(urls.map((url) => basename(new URL(url).pathname)))
      : undefined);
  return names?.length === urls.length ? names : undefined;
}

// The handle each opened file was read from, so a comparison of them can be stored in recents
const handleOfFile = new WeakMap<Blob, FileSystemFileHandle>();

export function rememberHandle(file: Blob, handle: FileSystemFileHandle): void {
  handleOfFile.set(file, handle);
}

/**
 * The handles of `files` (URLs stay as they are), or undefined when any file was not read from a
 * handle
 */
export function handlesOf(
  files: readonly Recording[],
): (FileSystemFileHandle | string)[] | undefined {
  const handles = files.map((file) => (typeof file === "string" ? file : handleOfFile.get(file)));
  return handles.every((h) => h != undefined) ? handles : undefined;
}

/**
 * The side name of each file when comparing them: its folder when the files come from more than
 * one folder (each folder is merged into one side), else its own name (each file is a side).
 */
export function defaultCompareSides(files: readonly Recording[]): string[] {
  const folders = files.map(folderOf);
  const distinctFolders = new Set(
    folders.filter((folder): folder is string => folder != undefined),
  );
  if (distinctFolders.size > 1) {
    // Loose files next to the folders are each a side of their own, never named like a folder
    const taken = new Set(distinctFolders);
    return folders.map((folder, index) => {
      if (folder != undefined) {
        return folder;
      }
      const base = recordingName(files[index]!);
      let name = base;
      for (let count = 2; taken.has(name); count++) {
        name = `${base} (${count})`;
      }
      taken.add(name);
      return name;
    });
  }
  return uniqueNames(files.map(recordingName));
}

/** `names` with repeats made unique: x, x (2), x (3), … */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((base) => {
    let name = base;
    for (let count = 2; taken.has(name); count++) {
      name = `${base} (${count})`;
    }
    taken.add(name);
    return name;
  });
}

/**
 * Args to open `recordings` with `source` merged into one recording (each once), e.g. a comparison
 * merged again. Remote ones keep their cookie setting.
 */
export function mergeArgs(
  source: IDataSourceFactory,
  recordings: readonly Recording[],
  { withCookies }: { withCookies: boolean },
): DataSourceArgs {
  const unique = [...new Set(recordings)];
  return source.type === "connection"
    ? {
        type: "connection",
        urls: unique.filter((r) => typeof r === "string"),
        params: {
          ...(withCookies && { includeCredentials: "true" }),
        },
      }
    : { type: "file", files: unique };
}

/** Recordings to compare as the compare dialog edits them */
export type CompareDraft = {
  /** Files added to every side, e.g. a map or calibration file every recording needs */
  shared: Recording[];
  /** One entry per side; a side of several files is merged into one recording */
  sides: { name: string; files: Recording[] }[];
  /** The remote recordings (URLs) fetched with cookies (`ds.includeCredentials`) */
  withCookies?: readonly string[];
};

/** The files to open and the side name of each (see FileDataSourceArgs.compare) */
export function draftToCompare(draft: CompareDraft): { files: Recording[]; compare: string[] } {
  const sides = draft.sides.filter((side) => side.files.length > 0);
  const names = uniqueNames(sides.map((side) => side.name.trim() || recordingName(side.files[0]!)));
  const files: Recording[] = [];
  const compare: string[] = [];
  sides.forEach((side, index) => {
    for (const file of new Set([...draft.shared, ...side.files])) {
      files.push(file);
      compare.push(names[index]!);
    }
  });
  return { files, compare };
}

/**
 * The draft for files already open: grouped by their side names when compared (a file in every
 * side is shared), else grouped as defaultCompareSides() would.
 */
export function draftFromFiles(
  files: readonly Recording[],
  compare?: readonly string[],
): CompareDraft {
  const names =
    compare?.length === files.length && compare.length > 0 ? compare : defaultCompareSides(files);
  const sideNames = [...new Set(names)];
  const filesOf = sideNames.map((name) => files.filter((_, index) => names[index] === name));
  const inEvery =
    sideNames.length > 1
      ? [...new Set(filesOf[0])].filter((file) => filesOf.every((f) => f.includes(file)))
      : [];
  // Only shared when every side keeps a file of its own, so no side disappears from the draft
  const shared = filesOf.every((f) => f.some((file) => !inEvery.includes(file))) ? inEvery : [];
  return {
    shared,
    sides: sideNames.map((name, index) => {
      const own = filesOf[index]!.filter((file) => !shared.includes(file));
      // A name that came from the side's first file stays empty, so it follows the files
      return {
        name: own[0] != undefined && recordingName(own[0]) === name ? "" : name,
        files: own,
      };
    }),
  };
}
