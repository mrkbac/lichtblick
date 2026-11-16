// SPDX-License-Identifier: MPL-2.0

// The folder each opened file came from, for files that don't carry it in webkitRelativePath
// (e.g. files read from a dropped folder)
const folderOfFile = new WeakMap<Blob, string>();

export function rememberFolder(file: Blob, folder: string): void {
  folderOfFile.set(file, folder);
}

function folderOf(file: File): string | undefined {
  const known = folderOfFile.get(file);
  if (known != undefined) {
    return known;
  }
  const parts = file.webkitRelativePath.split("/");
  return parts.length > 1 ? parts[0] : undefined;
}

// The handle each opened file was read from, so a comparison of them can be stored in recents
const handleOfFile = new WeakMap<Blob, FileSystemFileHandle>();

export function rememberHandle(file: Blob, handle: FileSystemFileHandle): void {
  handleOfFile.set(file, handle);
}

/** The handles of `files`, or undefined when any of them was not read from a handle */
export function handlesOf(files: readonly File[]): FileSystemFileHandle[] | undefined {
  const handles = files.map((file) => handleOfFile.get(file));
  return handles.every((h) => h != undefined) ? handles : undefined;
}

/**
 * The side name of each file when comparing them: its folder when the files come from more than
 * one folder (each folder is merged into one side), else its own name (each file is a side).
 */
export function defaultCompareSides(files: readonly File[]): string[] {
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
      const base = files[index]!.name;
      let name = base;
      for (let count = 2; taken.has(name); count++) {
        name = `${base} (${count})`;
      }
      taken.add(name);
      return name;
    });
  }
  return uniqueNames(files.map((file) => file.name));
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

/** Recordings to compare as the compare dialog edits them */
export type CompareDraft = {
  /** Files added to every side, e.g. a base recording the sides add their own topics to */
  shared: File[];
  /** One entry per side; a side of several files is merged into one recording */
  sides: { name: string; files: File[] }[];
};

/** The files to open and the side name of each (see FileDataSourceArgs.compare) */
export function draftToCompare(draft: CompareDraft): { files: File[]; compare: string[] } {
  const sides = draft.sides.filter((side) => side.files.length > 0);
  const names = uniqueNames(sides.map((side) => side.name.trim() || side.files[0]!.name));
  const files: File[] = [];
  const compare: string[] = [];
  sides.forEach((side, index) => {
    for (const file of [...draft.shared, ...side.files]) {
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
export function draftFromFiles(files: readonly File[], compare?: readonly string[]): CompareDraft {
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
      return { name: own[0]?.name === name ? "" : name, files: own };
    }),
  };
}
