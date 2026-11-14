// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import path from "path";

import {
  findRosPackage,
  makeCachedRosPackageFinder,
  registerRosPackageProtocolSchemes,
  rosPackageNameAtPath,
} from "./rosPackageResources";

const { registerSchemesAsPrivileged } = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
}));
vi.mock("electron", () => ({ protocol: { registerSchemesAsPrivileged }, net: {} }));

const FIXTURES_ROOT = path.join(__dirname, "./fixtures");
const PACKAGES_ROOT = path.join(FIXTURES_ROOT, "./packages");

describe("rosPackageResources", () => {
  describe("registerRosPackageProtocolSchemes", () => {
    it("allows cross-origin fetch from the file:// renderer", () => {
      registerRosPackageProtocolSchemes();
      expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
        { scheme: "package", privileges: { supportFetchAPI: true, corsEnabled: true } },
      ]);
    });
  });

  describe("makeCachedRosPackageFinder", () => {
    it("walks the search path once per package until the path changes", async () => {
      const find = vi.fn(async (pkg: string) => (pkg === "missing" ? undefined : `/root/${pkg}`));
      const findCached = makeCachedRosPackageFinder(find);

      await expect(findCached("foo", "/a")).resolves.toBe("/root/foo");
      await expect(findCached("foo", "/a")).resolves.toBe("/root/foo");
      expect(find).toHaveBeenCalledTimes(1);

      // misses are retried
      await findCached("missing", "/a");
      await findCached("missing", "/a");
      expect(find).toHaveBeenCalledTimes(3);

      // a new search path clears the cache
      await findCached("foo", "/b");
      expect(find).toHaveBeenCalledTimes(4);
      expect(find).toHaveBeenLastCalledWith("foo", { rosPackagePath: "/b" });
    });

    it("retries a lookup that failed", async () => {
      const find = vi
        .fn<typeof findRosPackage>()
        .mockRejectedValueOnce(new Error("EACCES"))
        .mockResolvedValueOnce("/root/foo");
      const findCached = makeCachedRosPackageFinder(find);

      await expect(findCached("foo", "/a")).rejects.toThrow("EACCES");
      await expect(findCached("foo", "/a")).resolves.toBe("/root/foo");
    });
  });

  describe("rosPackageNameAtPath", () => {
    it("should read package name from package.xml file at path", async () => {
      const name = await rosPackageNameAtPath(path.join(PACKAGES_ROOT, "./foo"));
      expect(name).toEqual("foo");
    });
  });

  describe("findRosPackage", () => {
    it("should find package within rosPackagePath", async () => {
      const packagePath = await findRosPackage("foo", { rosPackagePath: PACKAGES_ROOT });
      expect(packagePath).toEqual(path.join(PACKAGES_ROOT, "./foo"));
    });

    it("should find package within multiple rosPackagePaths", async () => {
      const packagePath = await findRosPackage("foo", {
        rosPackagePath: `${FIXTURES_ROOT}${path.delimiter}${PACKAGES_ROOT}`,
      });
      expect(packagePath).toEqual(path.join(PACKAGES_ROOT, "./foo"));
    });

    it("should find package within process.env.ROS_PACKAGE_PATH", async () => {
      process.env.ROS_PACKAGE_PATH = `${FIXTURES_ROOT}${path.delimiter}${PACKAGES_ROOT}`;
      try {
        const packagePath = await findRosPackage("foo");
        expect(packagePath).toEqual(path.join(PACKAGES_ROOT, "./foo"));
      } finally {
        process.env.ROS_PACKAGE_PATH = undefined;
      }
    });

    it("should find packages recursively within rosPackagePath", async () => {
      const packagePath = await findRosPackage("nested-child", {
        rosPackagePath: PACKAGES_ROOT,
      });
      expect(packagePath).toEqual(path.join(PACKAGES_ROOT, "nested", "child"));
    });
  });
});
