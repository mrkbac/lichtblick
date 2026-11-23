// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ipcRenderer } from "electron";
import { promises as fs } from "fs";
import path from "path";

import Logger from "@lichtblick/log";

import { DATASTORES_DIR_NAME } from "../common/storage";
import type { Storage } from "../common/types";

const log = Logger.getLogger(__filename);

// Datastores and keys become path segments under userData, so allow only plain names: no
// separators, no leading dot, no "..".
const DATASTORE_PATTERN = /^[a-z][a-z-]*$/;
const KEY_PATTERN = /^[\w-]+(?:\.[\w-]+)*$/;

export default class LocalFileStorage implements Storage {
  #userDataPath = ipcRenderer.invoke("getUserDataPath") as Promise<string>;

  public async get(datastore: string, key: string): Promise<string | undefined> {
    const filePath = await this.#makeFilePath(datastore, key);
    return await fs.readFile(filePath, "utf8").catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      return undefined;
    });
  }

  public async put(datastore: string, key: string, value: string): Promise<void> {
    const filePath = await this.#makeFilePath(datastore, key);
    log.debug(`Writing ${key} to ${filePath}`);
    await fs.writeFile(filePath, value);
  }

  async #makeFilePath(datastore: string, key: string): Promise<string> {
    const datastoreDir = await this.#ensureDatastorePath(datastore);
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`key (${key}) contains invalid characters`);
    }

    return path.join(datastoreDir, key);
  }

  async #ensureDatastorePath(datastore: string): Promise<string> {
    const basePath = await this.#userDataPath;
    if (!DATASTORE_PATTERN.test(datastore)) {
      throw new Error(`datastore (${datastore}) contains invalid characters`);
    }

    // There are other files and folders in the userDataPath. To avoid conflict we
    // store our datastores under a studio specific directory
    const datastoreDir = path.join(basePath, DATASTORES_DIR_NAME, datastore);
    await fs.mkdir(datastoreDir, { recursive: true });
    return datastoreDir;
  }
}
