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

  public override async getExtensions(): Promise<ExtensionInfo[]> {
    const directories = await this.directories();
    this.directoryErrors = [];
    const infos = await Promise.all(
      directories.map(async ({ directory, info }) => {
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
      }),
    );
    return [...(await super.getExtensions()), ...infos];
  }

  public override async getExtension(id: string): Promise<ExtensionInfo | undefined> {
    return (await this.getExtensions()).find((info) => info.id === id);
  }

  public override async loadExtension(id: string): Promise<{ raw: string }> {
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
    await (await this.#db).delete("directories", info.id);
    return info;
  }

  public override async uninstallExtension(id: string): Promise<void> {
    if ((await (await this.#db).get("directories", id)) != undefined) {
      await (await this.#db).delete("directories", id);
    } else {
      await super.uninstallExtension(id);
    }
  }
}
