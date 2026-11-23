// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Events that are forwarded from the main process
export type ForwardedMenuEvent =
  | "open"
  | "open-file"
  | "open-demo"
  | "open-help-about"
  | "open-help-docs"
  | "open-help-general";

export type ForwardedWindowEvent = "enter-full-screen" | "leave-full-screen";

/** Registering an event listener returns a function that will un-register the listener */
export type UnregisterFn = () => void;

interface NativeMenuBridge {
  /**
   * Events from the native window are available in the main process but not the renderer, so we
   * forward them through the bridge.
   *
   * Return a function to remove the registered event handler.
   *
   * NOTE: We use an unregister function return value because the preload <-> renderer bridge
   * intercepts the function. This changes the reference value of the _handler_ function and breaks
   * the conventional event emitter API of using `.off(event, handler)` to unregister an event
   * handler since the handler function that renderer would provided will get wrapped and won't
   * resolve to the same instance as the one in the `.on` call.
   *
   * https://www.electronjs.org/docs/latest/api/context-bridge#parameter--error--return-type-support
   */
  addIpcEventListener(eventName: ForwardedMenuEvent, handler: () => void): UnregisterFn;
}

/** Text files in the app's datastores (the settings file) */
interface Storage {
  get(datastore: string, key: string): Promise<string | undefined>;
  // Replaces any existing item with the same key
  put(datastore: string, key: string, value: string): Promise<void>;
}

type DesktopExtension = {
  id: string;
  packageJson: unknown;
  directory: string;
  readme: string;
  changelog: string;
};

type DesktopLayout = {
  layoutJson: unknown;
  from: string;
};

export type CLIFlags = Readonly<Record<string, string>>;

export type LoadedExtension = {
  buffer?: Uint8Array;
  raw: string;
};

interface Desktop {
  /** https://www.electronjs.org/docs/tutorial/represented-file */
  setRepresentedFilename(path: string | undefined): Promise<void>;

  addIpcEventListener(eventName: ForwardedWindowEvent, handler: () => void): UnregisterFn;

  /**
   * Notify the app that the color scheme setting has changed and the native theme may need to be
   * updated.
   */
  updateNativeColorScheme(): Promise<void>;

  // Get an array of deep links provided on app launch
  getDeepLinks: () => string[];

  // Get an array of available extensions and parsed package.json files
  getExtensions: () => Promise<DesktopExtension[]>;

  // Load the source code for an extension
  loadExtension: (id: string) => Promise<LoadedExtension>;

  // Fetch default layouts from local folder
  fetchLayouts: () => Promise<DesktopLayout[]>;

  // Install a Lichtblick extension (.foxe file) locally. The extension id is returned
  installExtension: (foxeFileData: Uint8Array) => Promise<DesktopExtension>;

  // Uninstall an extension. Returns true if the extension was found and uninstalled, or false if it
  // was not found (i.e. already uninstalled)
  uninstallExtension: (id: string) => Promise<boolean>;

  // Get CLI flags passed when the app was launched
  getCLIFlags: () => Promise<CLIFlags>;

  /** Handle a double-click on the custom title bar */
  handleTitleBarDoubleClick(): void;

  /** Notify the app that the language setting has been changed */
}

export type { Desktop, DesktopExtension, DesktopLayout, NativeMenuBridge, Storage };
