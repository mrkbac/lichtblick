// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { DOMParser } from "@xmldom/xmldom";
import { protocol, net } from "electron";
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";

import Logger from "@lichtblick/log";
import { AppSetting } from "@lichtblick/suite-base/src/AppSetting";

import { readAppSetting } from "./settings";

const log = Logger.getLogger(__filename);

/** Extract a package name from a ROS package.xml file. */
function rosPackageName(packageXmlContents: string) {
  const doc = new DOMParser().parseFromString(packageXmlContents, "text/xml");
  const packageName = Array.from(
    (doc as Partial<typeof doc>).documentElement?.childNodes ?? [],
  ).find((n) => n.nodeName.toLowerCase() === "name")?.textContent;
  return packageName ?? undefined;
}

/**
 * Read package.xml from the given directory to determine if it is a ROS package. If so, return the
 * `<name/>` of the package.
 */
export async function rosPackageNameAtPath(packagePath: string): Promise<string | undefined> {
  try {
    const contents = await fs.readFile(path.join(packagePath, "package.xml"), {
      encoding: "utf-8",
    });
    return rosPackageName(contents);
  } catch (err: unknown) {
    // Most directories on the search path are not packages
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.error(err);
    }
    return undefined;
  }
}

/**
 * Find ROS package named `pkg` within the `rootPath`
 *
 * rootPath is searched recursively
 */
export async function findRosPackageInRoot(
  pkg: string,
  rootPath: string,
): Promise<string | undefined> {
  const packagePaths = await fs.readdir(rootPath, { withFileTypes: true });
  log.debug(`searching ${rootPath} for packages`);

  const directories = packagePaths.filter((pkgPath) => pkgPath.isDirectory());

  // Check any of our immediate folders for the package
  for (const packagePath of directories) {
    const absolutePath = path.join(rootPath, packagePath.name);

    const packageName = await rosPackageNameAtPath(absolutePath);
    if (packageName === pkg) {
      return absolutePath;
    }
  }

  // Recurse into all directories
  for (const packagePath of directories) {
    const absolutePath = path.join(rootPath, packagePath.name);
    const foundPath = await findRosPackageInRoot(pkg, absolutePath);
    if (foundPath) {
      return foundPath;
    }
  }

  return;
}

/**
 * Search for a ROS package.
 *
 * The search algorithm attempts to find the package in this order. It stops as soon as the package
 * is found:
 * - If options.rosPackagePath is set, this folder(s) are searched recursively
 * - If env.ROS_PACKAGE_PATH is available, this folder(s) are searched recursively
 *
 * https://wiki.ros.org/ROS/EnvironmentVariables#ROS_PACKAGE_PATH
 */
export async function findRosPackage(
  pkg: string,
  options?: { rosPackagePath?: string },
): Promise<string | undefined> {
  // log.debug(`findRosPackage(${pkg}, ${rosPackagePath}, ${searchPath})`);

  const rosPackagePaths: string[] = [];

  // Search options.rosPackagePath
  if (options?.rosPackagePath) {
    rosPackagePaths.push(...options.rosPackagePath.split(path.delimiter));
  }

  // Search env.ROS_PACKAGE_PATH
  if (process.env.ROS_PACKAGE_PATH) {
    rosPackagePaths.push(...process.env.ROS_PACKAGE_PATH.split(path.delimiter));
  }

  for (const rosPackagePath of rosPackagePaths) {
    const packagePath = await findRosPackageInRoot(pkg, rosPackagePath);
    if (packagePath) {
      // log.info(`Found ROS package "${pkg}" at "${packagePath}" (in ROS_PACKAGE_PATH "${ROS_PACKAGE_PATH}")`);
      return packagePath;
    }
  }

  log.warn(`Could not find ROS package "${pkg}" in: ${rosPackagePaths.join(path.delimiter)}`);
  return undefined;
}

// https://source.chromium.org/chromium/chromium/src/+/master:net/base/net_error_list.h
// The error code for registerFileProtocol must be from the net error list
// const NET_ERROR_FAILED = -2;

/**
 * Register handlers for package: protocol
 *
 * The package: protocol handler attempts to load resources using ROS_PACKAGE_PATH lookup semantics.
 */
/**
 * Returns findRosPackage with a cache of package name to root directory. A scene loads many meshes
 * from the same few packages, and each lookup walks the whole search path. The cache is cleared
 * when the search path changes; lookups that found nothing are retried.
 */
export function makeCachedRosPackageFinder(
  find: typeof findRosPackage = findRosPackage,
): (pkg: string, rosPackagePath: string) => Promise<string | undefined> {
  let cachedFor: string | undefined;
  const packageRoots = new Map<string, Promise<string | undefined>>();
  return async (pkg, rosPackagePath) => {
    if (cachedFor !== rosPackagePath) {
      cachedFor = rosPackagePath;
      packageRoots.clear();
    }
    let root = packageRoots.get(pkg);
    if (!root) {
      root = find(pkg, { rosPackagePath });
      packageRoots.set(pkg, root);
    }
    const found = await root;
    if (!found && packageRoots.get(pkg) === root) {
      packageRoots.delete(pkg);
    }
    return found;
  };
}

export function registerRosPackageProtocolHandlers(): void {
  const findCachedRosPackage = makeCachedRosPackageFinder();

  protocol.handle("package", async (request) => {
    try {
      // Give preference to the ROS_PACKAGE_PATH app setting over the environment variable
      const rosPackagePath =
        (await readAppSetting<string>(AppSetting.ROS_PACKAGE_PATH)) ?? process.env.ROS_PACKAGE_PATH;

      log.debug(`Load: ${request.url} (ROS_PACKAGE_PATH ${rosPackagePath})`);
      if (!rosPackagePath) {
        throw new Error("ROS_PACKAGE_PATH not set");
      }

      const url = new URL(request.url);
      const targetPkg = url.host;
      const relPath = url.pathname;

      const pkgRoot = await findCachedRosPackage(targetPkg, rosPackagePath);

      if (!pkgRoot) {
        throw new Error(
          `ROS package ${targetPkg} not found in any ROS_PACKAGE_PATH: ${rosPackagePath}.`,
        );
      }

      const resolvedResourcePath = path.join(pkgRoot, ...relPath.split("/"));
      log.debug(`Resolved: ${resolvedResourcePath}`);
      // prepend the file:// protocol to the path
      const fileUrl = pathToFileURL(resolvedResourcePath).toString();
      return await net.fetch(fileUrl);
    } catch (err: unknown) {
      log.error("Error loading from ROS package url", request.url, err);
      return Response.error();
    }
  });
}

/**
 * Enable fetch for the package: URL scheme. The renderer runs on a file:// origin, so these requests
 * are cross-origin and Chromium blocks them unless the scheme is CORS-enabled.
 */
export function registerRosPackageProtocolSchemes(): void {
  const privileges = { supportFetchAPI: true, corsEnabled: true };
  protocol.registerSchemesAsPrivileged([{ scheme: "package", privileges }]);
}
