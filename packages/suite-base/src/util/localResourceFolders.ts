// SPDX-License-Identifier: MPL-2.0

import i18next from "i18next";

import Logger from "@lichtblick/log";
import { Asset } from "@lichtblick/suite-base/components/PanelExtensionAdapter/types";
import { createKeyValueStore, KeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";

const log = Logger.getLogger(__filename);
const FOLDERS_KEY = "folders";

type PackageDirectory = { name: string; path: string[] };
type ResourceFolder = {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  packages: PackageDirectory[];
  /** Restored from a previous visit; the browser needs a click to grant read access again. */
  needsPermission: boolean;
};
type StoredFolder = { id: string; handle: FileSystemDirectoryHandle };
type Snapshot = { revision: number; folders: readonly ResourceFolder[] };

/**
 * Folders the user picked, remembered across visits when a store is given. Handles are never
 * inferred from paths or environment variables.
 */
export class LocalResourceFolders {
  #snapshot: Snapshot = { revision: 0, folders: [] };
  #listeners = new Set<() => void>();
  #store?: KeyValueStore;
  #restoring?: Promise<void>;
  /** Saving before the stored list is read would overwrite it. */
  #loaded = false;
  #saving = Promise.resolve();

  public constructor(store?: KeyValueStore) {
    this.#store = store;
    this.#loaded = store == undefined;
  }

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
    const store = this.#store;
    if (store && this.#loaded) {
      const stored: StoredFolder[] = folders.map(({ id, handle }) => ({ id, handle }));
      this.#saving = this.#saving
        .then(async () => {
          await store.set(FOLDERS_KEY, stored);
        })
        .catch((error: unknown) => {
          log.warn("Could not save local resource folders", error);
        });
    }
  }

  /** Loads folders from previous visits once; ones still granted are rescanned without a click. */
  public async restore(): Promise<void> {
    this.#restoring ??= this.#restore();
    await this.#restoring;
  }

  async #restore(): Promise<void> {
    const store = this.#store;
    if (!store) {
      return;
    }
    let stored: StoredFolder[] = [];
    try {
      stored = (await store.get<StoredFolder[]>(FOLDERS_KEY)) ?? [];
    } catch (error) {
      log.warn("Could not load local resource folders", error);
    }
    this.#loaded = true;
    if (stored.length === 0) {
      return;
    }
    this.#update(
      stored.map(({ id, handle }) => ({
        id,
        name: handle.name,
        handle,
        packages: [],
        needsPermission: true,
      })),
    );
    for (const { handle } of stored) {
      const permission = await handle.queryPermission({ mode: "read" }).catch(() => "denied");
      if (permission !== "granted") {
        continue;
      }
      // A folder that moved or vanished stays listed so the user can see and remove it.
      await this.#add(handle).catch((error: unknown) => {
        log.warn(`Could not rescan local resource folder ${handle.name}`, error);
      });
    }
  }

  /** Must be called from a user gesture: the browser may show a permission prompt. */
  public async reconnect(id: string): Promise<void> {
    const folder = this.#snapshot.folders.find((item) => item.id === id);
    if (folder && (await folder.handle.requestPermission({ mode: "read" })) === "granted") {
      await this.#add(folder.handle);
    }
  }

  public async add(handle: FileSystemDirectoryHandle): Promise<void> {
    // Waiting only when needed keeps a rescan in step with a remove() issued right after it.
    if (!this.#loaded) {
      await this.restore();
    }
    await this.#add(handle);
  }

  async #add(handle: FileSystemDirectoryHandle): Promise<void> {
    const folders = this.#snapshot.folders;
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
    for (const folder of [...folders, ...this.#snapshot.folders]) {
      if (await folder.handle.isSameEntry(handle)) {
        existing = folder;
        break;
      }
    }
    // A completed rescan must not restore a grant removed while it was running.
    if (existing && !this.#snapshot.folders.includes(existing)) {
      return;
    }
    const folder: ResourceFolder = {
      id: existing?.id ?? crypto.randomUUID(),
      name: handle.name,
      handle,
      packages,
      needsPermission: false,
    };
    // Replace in place so restored folders keep their order.
    this.#update(
      existing
        ? this.#snapshot.folders.map((item) => (item === existing ? folder : item))
        : [...this.#snapshot.folders, folder],
    );
  }

  public remove(id: string): void {
    this.#update(this.#snapshot.folders.filter((folder) => folder.id !== id));
  }

  public async fetchAsset(
    uri: string,
    options?: { signal?: AbortSignal },
  ): Promise<Asset | undefined> {
    await this.restore();
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
      // The package may be inside a folder that is not scanned until access is granted again.
      if (!folder && this.#snapshot.folders.some((root) => root.needsPermission)) {
        throw new Error(i18next.t("appSettings:localResourceFolderNeedsPermission"));
      }
    } else {
      folder = this.#snapshot.folders.find((root) => root.id === authority);
      if (!folder) {
        throw new Error(i18next.t("appSettings:localResourceFolderUnavailable"));
      }
    }
    if (!folder) {
      return undefined;
    }
    if (folder.needsPermission) {
      throw new Error(i18next.t("appSettings:localResourceFolderNeedsPermission"));
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

export const localResourceFolders = new LocalResourceFolders(
  createKeyValueStore("lichtblick-local-resource-folders", "folders"),
);
