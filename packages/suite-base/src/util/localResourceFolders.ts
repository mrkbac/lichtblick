// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import i18next from "i18next";

import { Asset } from "@lichtblick/suite-base/components/PanelExtensionAdapter/types";

type PackageDirectory = { name: string; path: string[] };
type ResourceFolder = {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  packages: PackageDirectory[];
};
type Snapshot = { revision: number; folders: readonly ResourceFolder[] };

/** Grants live only in this tab. Handles are never inferred from paths or environment variables. */
export class LocalResourceFolders {
  #snapshot: Snapshot = { revision: 0, folders: [] };
  #listeners = new Set<() => void>();

  public getSnapshot = (): Snapshot => this.#snapshot;
  public subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #update(folders: readonly ResourceFolder[]): void {
    this.#snapshot = { revision: this.#snapshot.revision + 1, folders };
    this.#listeners.forEach((listener) => {
      listener();
    });
  }

  public async add(handle: FileSystemDirectoryHandle): Promise<void> {
    const packages: PackageDirectory[] = [];
    const scan = async (directory: FileSystemDirectoryHandle, path: string[]): Promise<void> => {
      // Colcon marks generated build/install/log trees; an explicitly selected root remains usable.
      if (path.length > 0) {
        try {
          await directory.getFileHandle("COLCON_IGNORE");
          return;
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== "NotFoundError") {
            throw error;
          }
        }
      }
      let manifest: FileSystemFileHandle | undefined;
      try {
        manifest = await directory.getFileHandle("package.xml");
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotFoundError") {
          throw error;
        }
      }
      if (manifest) {
        const xml = new DOMParser().parseFromString(
          await (await manifest.getFile()).text(),
          "text/xml",
        );
        const name = Array.from(xml.documentElement.children)
          .find((node) => node.tagName === "name")
          ?.textContent.trim();
        if (
          xml.querySelector("parsererror") ||
          xml.documentElement.tagName !== "package" ||
          !name ||
          !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)
        ) {
          throw new Error(
            i18next.t("appSettings:localResourceInvalidManifest", {
              path: [handle.name, ...path].join("/"),
            }),
          );
        }
        packages.push({ name, path });
        // ROS packages are not nested; avoid walking large mesh/build trees inside each package.
        return;
      }
      for await (const entry of directory.values()) {
        if (entry.kind === "directory" && entry.name !== ".git") {
          await scan(entry, [...path, entry.name]);
        }
      }
    };
    await scan(handle, []);
    let existing: ResourceFolder | undefined;
    for (const folder of this.#snapshot.folders) {
      if (await folder.handle.isSameEntry(handle)) {
        existing = folder;
        break;
      }
    }
    const folder = { id: existing?.id ?? crypto.randomUUID(), name: handle.name, handle, packages };
    this.#update([...this.#snapshot.folders.filter((item) => item !== existing), folder]);
  }

  public remove(id: string): void {
    this.#update(this.#snapshot.folders.filter((folder) => folder.id !== id));
  }

  public async fetchAsset(
    uri: string,
    options?: { signal?: AbortSignal },
  ): Promise<Asset | undefined> {
    const match = /^(package|local-asset):\/\/([^/?#]+)\/([^?#]*)(?:[?#].*)?$/.exec(uri);
    if (!match) {
      if (uri.startsWith("package:") || uri.startsWith("local-asset:")) {
        throw new Error(i18next.t("appSettings:localResourceInvalidUrl"));
      }
      return undefined;
    }
    const [, protocol, authority, path] = match;
    let segments: string[];
    try {
      segments = path!.split("/").map(decodeURIComponent);
    } catch {
      throw new Error(i18next.t("appSettings:localResourceInvalidUrl"));
    }
    if (segments.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part))) {
      throw new Error(i18next.t("appSettings:localResourcePathOutsideFolder"));
    }
    let folder: ResourceFolder | undefined;
    let packagePath: string[] = [];
    if (protocol === "package") {
      const candidates = this.#snapshot.folders.flatMap((root) =>
        root.packages.filter((pkg) => pkg.name === authority).map((pkg) => ({ root, pkg })),
      );
      if (candidates.length > 1) {
        throw new Error(
          i18next.t("appSettings:localResourceDuplicatePackage", { name: authority }),
        );
      }
      folder = candidates[0]?.root;
      packagePath = candidates[0]?.pkg.path ?? [];
    } else {
      folder = this.#snapshot.folders.find((root) => root.id === authority);
      if (!folder) {
        throw new Error(i18next.t("appSettings:localResourceFolderUnavailable"));
      }
    }
    if (!folder) {
      return undefined;
    }
    options?.signal?.throwIfAborted();
    let file: File;
    try {
      let directory = folder.handle;
      for (const segment of [...packagePath, ...segments.slice(0, -1)]) {
        directory = await directory.getDirectoryHandle(segment);
      }
      file = await (await directory.getFileHandle(segments.at(-1)!)).getFile();
    } catch (error) {
      if (
        protocol === "package" &&
        error instanceof DOMException &&
        error.name === "NotFoundError"
      ) {
        options?.signal?.throwIfAborted();
        return undefined;
      }
      throw error;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    options?.signal?.throwIfAborted();
    return {
      uri: `local-asset://${folder.id}/${[...packagePath, ...segments].map(encodeURIComponent).join("/")}`,
      data,
      mediaType: file.type || undefined,
    };
  }
}

export const localResourceFolders = new LocalResourceFolders();
