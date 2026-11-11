// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DBSchema, openDB } from "idb";

import { KEY_WORKSPACE_PREFIX } from "@lichtblick/suite-base/constants/browserStorageKeys";
import { InstallExtensionProps } from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import { IdbExtensionLoader } from "@lichtblick/suite-base/services/extension/IdbExtensionLoader";
import validatePackageInfo from "@lichtblick/suite-base/services/extension/utils/validatePackageInfo";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

type DirectoryExtension = { directory: FileSystemDirectoryHandle; info: ExtensionInfo };
interface DirectoryDB extends DBSchema {
  directories: { key: string; value: DirectoryExtension };
}

async function readText(directory: FileSystemDirectoryHandle, name: string): Promise<string> {
  return await (await (await directory.getFileHandle(name)).getFile()).text();
}

async function readOptionalText(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<string> {
  try {
    return await readText(directory, name);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return "";
    }
    throw error;
  }
}

async function readInfo(directory: FileSystemDirectoryHandle): Promise<ExtensionInfo> {
  const raw: unknown = JSON.parse(await readText(directory, "package.json"));
  if (
    typeof raw !== "object" ||
    raw == undefined ||
    !("name" in raw) ||
    typeof raw.name !== "string" ||
    ("publisher" in raw && typeof raw.publisher !== "string") ||
    ("displayName" in raw && typeof raw.displayName !== "string")
  ) {
    throw new Error("Invalid extension package.json");
  }
  const info = validatePackageInfo(raw as Partial<ExtensionInfo>);
  return {
    ...info,
    id: `${info.publisher.replace(/[^A-Za-z0-9_\s]+/g, "")}.${info.name}`,
    namespace: "local",
    displayName: info.displayName || info.name,
    version: "version" in raw && typeof raw.version === "string" ? raw.version : "",
    qualifiedName: info.displayName || info.name,
    readme: await readOptionalText(directory, "README.md"),
    changelog: await readOptionalText(directory, "CHANGELOG.md"),
  };
}

export class WebExtensionLoader extends IdbExtensionLoader {
  readonly #db = openDB<DirectoryDB>(`${KEY_WORKSPACE_PREFIX}lichtblick-extension-folders`, 1, {
    upgrade(database) {
      database.createObjectStore("directories");
    },
  });

  public constructor() {
    super("local");
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      this.loadExtensionFromDirectory = async () => {
        const directory = await window.showDirectoryPicker({
          id: "lichtblick-extensions",
          mode: "read",
        });
        const info = await readInfo(directory);
        await this.readSource(directory);
        if (await super.getExtension(info.id)) {
          throw new Error(
            "Uninstall the browser copy of this extension before loading its folder.",
          );
        }
        const entries = await this.directories();
        const replacedIds: string[] = [];
        for (const entry of entries) {
          if (entry.info.id !== info.id && (await directory.isSameEntry(entry.directory))) {
            replacedIds.push(entry.info.id);
          }
        }
        const tx = (await this.#db).transaction("directories", "readwrite");
        await Promise.all([
          ...replacedIds.map(async (id) => {
            await tx.store.delete(id);
          }),
          tx.store.put({ directory, info }, info.id),
          tx.done,
        ]);
        // A package installed while the chooser was open takes precedence.
        if (await super.getExtension(info.id)) {
          try {
            await (await this.#db).delete("directories", info.id);
          } catch (error) {
            throw new Error(
              `Uninstall the browser copy before loading its folder. Folder cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          throw new Error(
            "Uninstall the browser copy of this extension before loading its folder.",
          );
        }
      };
    }
  }

  public directoryErrors: string[] = [];

  public loadExtensionFromDirectory?: () => Promise<void>;

  private async directories(): Promise<DirectoryExtension[]> {
    return await (await this.#db).getAll("directories");
  }

  private async readSource(directory: FileSystemDirectoryHandle): Promise<{ raw: string }> {
    if ((await directory.queryPermission({ mode: "read" })) !== "granted") {
      throw new Error(
        "Extension folder access is unavailable. Select the folder again to reconnect.",
      );
    }
    const dist = await directory.getDirectoryHandle("dist");
    return { raw: await readText(dist, "extension.js") };
  }

  private async readDirectoryInfo({ directory, info }: DirectoryExtension): Promise<ExtensionInfo> {
    try {
      await this.readSource(directory);
      const updated = await readInfo(directory);
      if (updated.id !== info.id) {
        throw new Error("Extension identity changed. Select its folder again.");
      }
      return updated;
    } catch (error) {
      this.directoryErrors.push(
        `${info.qualifiedName}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return info;
    }
  }

  public override async getExtensions(): Promise<ExtensionInfo[]> {
    const packages = await super.getExtensions();
    this.directoryErrors = [];
    let directories: DirectoryExtension[];
    try {
      directories = await this.directories();
    } catch (error) {
      this.directoryErrors.push(error instanceof Error ? error.message : String(error));
      return packages;
    }
    const packageIds = new Set(packages.map((info) => info.id));
    const infos = await Promise.all(
      directories.map(async (entry) => {
        if (packageIds.has(entry.info.id)) {
          try {
            await (await this.#db).delete("directories", entry.info.id);
          } catch (error) {
            this.directoryErrors.push(error instanceof Error ? error.message : String(error));
          }
          return undefined;
        }
        return await this.readDirectoryInfo(entry);
      }),
    );
    return [...packages, ...infos.filter((info) => info != undefined)];
  }

  public override async getExtension(id: string): Promise<ExtensionInfo | undefined> {
    const installed = await super.getExtension(id);
    if (installed) {
      return installed;
    }
    const entry = await (await this.#db).get("directories", id);
    return entry != undefined ? await this.readDirectoryInfo(entry) : undefined;
  }

  public override async loadExtension(id: string): Promise<{ raw: string }> {
    if (await super.getExtension(id)) {
      return await super.loadExtension(id);
    }
    const entry = (await this.directories()).find(({ info }) => info.id === id);
    if (!entry) {
      return await super.loadExtension(id);
    }
    if ((await readInfo(entry.directory)).id !== id) {
      throw new Error("Extension identity changed. Select its folder again.");
    }
    return await this.readSource(entry.directory);
  }

  public override async installExtension(data: InstallExtensionProps): Promise<ExtensionInfo> {
    // A linked folder must never shadow an installed package with the same identity.
    const info = await super.installExtension(data);
    try {
      await (await this.#db).delete("directories", info.id);
    } catch (error) {
      this.directoryErrors.push(error instanceof Error ? error.message : String(error));
    }
    return info;
  }

  public override async uninstallExtension(id: string): Promise<void> {
    // Forget the folder first so it cannot reactivate after the package is removed.
    await (await this.#db).delete("directories", id);
    await super.uninstallExtension(id);
  }
}
