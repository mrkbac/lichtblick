// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { exec } from "@actions/exec";
import { downloadTool, extractZip } from "@actions/tool-cache";
import { log, Arch } from "builder-util";
import crypto from "crypto";
import type { AfterPackContext } from "electron-builder";
import fs from "fs/promises";
import path from "path";

export default async function afterPack(context: AfterPackContext): Promise<void> {
  await copySpotlightImporter(context);
  await assertNoSourceMaps(context.appOutDir);
}

/** Lists the file paths stored in an asar archive (header layout: see @electron/asar). */
export async function listAsarFiles(asarPath: string): Promise<string[]> {
  const file = await fs.open(asarPath, "r");
  try {
    const sizes = Buffer.alloc(16);
    await file.read(sizes, 0, 16, 0);
    // pickle(uint32 headerSize) followed by pickle(string header): the JSON length is at offset 12
    const jsonLength = sizes.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    await file.read(json, 0, jsonLength, 16);
    type Entry = { files?: Record<string, Entry> };
    const paths: string[] = [];
    const walk = (entry: Entry, prefix: string) => {
      for (const [name, child] of Object.entries(entry.files ?? {})) {
        const childPath = `${prefix}${name}`;
        if (child.files) {
          walk(child, `${childPath}/`);
        } else {
          paths.push(childPath);
        }
      }
    };
    walk(JSON.parse(json.toString("utf8")) as Entry, "");
    return paths;
  } finally {
    await file.close();
  }
}

/**
 * Source maps doubled the app size; electronBuilderConfig.js excludes them.
 * Checks loose files and the contents of app.asar.
 */
async function assertNoSourceMaps(appOutDir: string): Promise<void> {
  const entries = await fs.readdir(appOutDir, { recursive: true });
  const looseMaps = entries.filter((entry) => entry.endsWith(".map"));
  if (looseMaps.length > 0) {
    throw new Error(`The app contains ${looseMaps.length} source maps, e.g. ${looseMaps[0]}`);
  }
  const asars = entries.filter((entry) => path.basename(entry) === "app.asar");
  if (asars.length === 0) {
    throw new Error(`No app.asar found in ${appOutDir}`);
  }
  for (const asar of asars) {
    const maps = (await listAsarFiles(path.join(appOutDir, asar))).filter((file) =>
      file.endsWith(".map"),
    );
    if (maps.length > 0) {
      throw new Error(`${asar} contains ${maps.length} source maps, e.g. ${maps[0]}`);
    }
  }
}

/**
 * When building a universal app, electron-builder uses lipo to merge binaries at the same path.
 * Since our bundled Spotlight extension already provides universal binaries, we need
 * to strip out other architectures so that lipo doesn't fail when it gets two copies of each slice.
 */
async function extractTargetArchitecture(executablePath: string, context: AfterPackContext) {
  const arch = new Map([
    [Arch.arm64, "arm64"],
    [Arch.x64, "x86_64"],
    [Arch.universal, "universal"],
  ]).get(context.arch);
  if (arch == undefined) {
    throw new Error(`Unsupported arch ${context.arch}`);
  }
  if (arch !== "universal") {
    await exec("lipo", ["-extract", arch, executablePath, "-output", executablePath]);
    log.info({ executablePath }, `Extracted ${arch} from universal executable`);
  }
}

/**
 * Download the Spotlight importer for MCAP files and include it in the app bundle.
 */
async function copySpotlightImporter(context: AfterPackContext) {
  const { electronPlatformName, outDir, appOutDir } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const spotlightDirPath = path.join(appPath, "Contents", "Library", "Spotlight");
  const zipPath = path.join(outDir, "MCAPSpotlightImporter.mdimporter.zip");
  await fs.unlink(zipPath).catch(() => {});

  const zipURL =
    "https://github.com/foxglove/MCAPSpotlightImporter/releases/download/v1.0.2/MCAPSpotlightImporter.mdimporter.zip";
  const zipSHA = "26cafa3e3069fcbd294864ceeee1bc9899e94456e0d28079f966787b6f05c7a2";
  await downloadTool(zipURL, zipPath);
  const actualSHA = crypto
    .createHash("sha256")
    .update(new Uint8Array(await fs.readFile(zipPath)))
    .digest("hex");
  if (actualSHA !== zipSHA) {
    throw new Error(`SHA mismatch for ${zipURL}: expected ${zipSHA}, got ${actualSHA}`);
  }
  try {
    await extractZip(zipPath, spotlightDirPath);
    const executablePath = path.join(
      spotlightDirPath,
      "MCAPSpotlightImporter.mdimporter",
      "Contents",
      "MacOS",
      "MCAPSpotlightImporter",
    );
    await extractTargetArchitecture(executablePath, context);
  } finally {
    await fs.unlink(zipPath).catch((err: unknown) => {
      log.error(String(err));
    });
  }
  log.info({ path: spotlightDirPath }, "Copied mdimporter");
}
