// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PreloaderSockets } from "@foxglove/electron-socket/preloader";
import { contextBridge, ipcRenderer } from "electron";
import os from "os";
import { join as pathJoin } from "path";

import Logger from "@lichtblick/log";
import { NetworkInterface, OsContext } from "@lichtblick/suite-base/src/OsContext";

import { ExtensionsHandler } from "./ExtensionHandler";
import LocalFileStorage from "./LocalFileStorage";
import { fetchLayouts } from "./layouts";
import { decodeRendererArg } from "../common/rendererArgs";
import {
  CLIFlags,
  Desktop,
  ForwardedMenuEvent,
  ForwardedWindowEvent,
  NativeMenuBridge,
  Storage,
} from "../common/types";
import { LICHTBLICK_PRODUCT_NAME, LICHTBLICK_PRODUCT_VERSION } from "../common/webpackDefines";

const deepLinks = decodeRendererArg("deepLinks", window.process.argv) ?? [];

export function main(): void {
  const log = Logger.getLogger(__filename);

  log.debug(`Start Preload`);
  log.info(`${LICHTBLICK_PRODUCT_NAME} ${LICHTBLICK_PRODUCT_VERSION}`);
  log.info(`initializing preloader, argv="${window.process.argv.join(" ")}"`);

  window.onerror = (ev) => {
    console.error(ev);
  };

  // Initialize the RPC channel for electron-socket asynchronously
  PreloaderSockets.Create().catch((err: unknown) => {
    log.error("Failed to initialize preloader sockets", err);
  });

  window.addEventListener(
    "DOMContentLoaded",
    () => {
      // This input element receives generated dom events from main thread to inject File objects
      // See the comments in desktop/index.ts regarding this feature
      const input = document.createElement("input");
      input.setAttribute("hidden", "true");
      input.setAttribute("type", "file");
      input.setAttribute("id", "electron-open-file-input");
      input.setAttribute("multiple", "true");
      document.body.appendChild(input);

      // let main know we are ready to accept open-file requests
      void ipcRenderer.invoke("load-pending-files");
    },
    { once: true },
  );

  const localFileStorage = new LocalFileStorage();

  const ctx: OsContext = {
    platform: process.platform,
    pid: process.pid,

    // Environment queries
    getEnvVar: (envVar: string) => process.env[envVar],
    getHostname: os.hostname,
    getNetworkInterfaces: (): NetworkInterface[] => {
      const output: NetworkInterface[] = [];
      const ifaces = os.networkInterfaces();
      for (const name in ifaces) {
        const iface = ifaces[name];
        if (iface == undefined) {
          continue;
        }
        for (const info of iface) {
          output.push({ name, ...info, cidr: info.cidr ?? undefined });
        }
      }
      return output;
    },
    getAppVersion: (): string => {
      return LICHTBLICK_PRODUCT_VERSION;
    },
  };

  let extensionHandler: ExtensionsHandler | undefined;

  const getExtensionHandler = async (): Promise<ExtensionsHandler> => {
    if (!extensionHandler) {
      const homePath = (await ipcRenderer.invoke("getHomePath")) as string;
      const userExtensionsDir = pathJoin(homePath, ".lichtblick-suite", "extensions");
      extensionHandler = new ExtensionsHandler(userExtensionsDir);
    }
    return extensionHandler;
  };

  const desktopBridge: Desktop = {
    addIpcEventListener(eventName: ForwardedWindowEvent, handler: () => void) {
      ipcRenderer.on(eventName, handler);
      return () => {
        ipcRenderer.off(eventName, handler);
      };
    },
    async updateNativeColorScheme() {
      await ipcRenderer.invoke("updateNativeColorScheme");
    },
    async getCLIFlags(): Promise<CLIFlags> {
      return await (ipcRenderer.invoke("getCLIFlags") as Promise<CLIFlags>);
    },
    getDeepLinks(): string[] {
      return deepLinks;
    },
    // Layout management
    async fetchLayouts() {
      const userLayoutsDir = pathJoin(
        (await ipcRenderer.invoke("getHomePath")) as string,
        ".lichtblick-suite",
        "layouts",
      );
      return await fetchLayouts(userLayoutsDir);
    },
    // Extension management
    async getExtensions() {
      const handler = await getExtensionHandler();
      return await handler.list();
    },
    async loadExtension(id: string) {
      const handler = await getExtensionHandler();
      return await handler.load(id);
    },
    async installExtension(foxeFileData: Uint8Array) {
      const handler = await getExtensionHandler();
      return await handler.install(foxeFileData);
    },
    async uninstallExtension(id: string): Promise<boolean> {
      const handler = await getExtensionHandler();
      return await handler.uninstall(id);
    },
    handleTitleBarDoubleClick() {
      ipcRenderer.send("titleBarDoubleClicked");
    },
  };

  const storageBridge: Storage = {
    // Context bridge cannot expose "classes" only exposes functions
    // We use .bind to attach the localFileStorage instance as _this_ to the function
    get: localFileStorage.get.bind(localFileStorage),
    put: localFileStorage.put.bind(localFileStorage),
  };

  const menuBridge: NativeMenuBridge = {
    addIpcEventListener(eventName: ForwardedMenuEvent, handler: () => void) {
      ipcRenderer.on(eventName, handler);

      // We use an unregister handler return value approach because the bridge interface wraps
      // the handler function that render provides making it impossible for renderer to provide the
      // same function reference to `.off`.
      //
      // https://www.electronjs.org/docs/latest/api/context-bridge#parameter--error--return-type-support
      return () => {
        ipcRenderer.off(eventName, handler);
      };
    },
  };

  // NOTE: Context Bridge imposes a number of limitations around how objects move between the context
  // and the renderer. These restrictions impact what the api surface can expose and how.
  //
  // exposeInMainWorld is poorly named - it exposes the object to the renderer
  //
  // i.e.: returning a class instance doesn't work because prototypes do not survive the boundary
  contextBridge.exposeInMainWorld("ctxbridge", ctx);
  contextBridge.exposeInMainWorld("menuBridge", menuBridge);
  contextBridge.exposeInMainWorld("storageBridge", storageBridge);
  contextBridge.exposeInMainWorld("desktopBridge", desktopBridge);

  log.debug(`End Preload`);
}
