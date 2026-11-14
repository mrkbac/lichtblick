// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
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
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}
