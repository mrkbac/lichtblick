// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// `global` is a Node.js global. TypeScript 6.0 no longer auto-discovers `@types/node`, so reference
// it explicitly to keep the global available program-wide.
/// <reference types="node" />

// logger channel -> logger
const channels = new Map<string, Logger>();
const channelListeners = new Set<() => void>();

const noop = () => {};

// Ordered from least to most verbose
const LEVELS = ["error", "warn", "info", "debug"] as const;
type LogLevel = (typeof LEVELS)[number];

class Logger {
  // default logger has an empty name
  public static default = new Logger("");

  #name: string;
  #level = LEVELS.indexOf("debug");

  // all new loggers are created from the default logger
  private constructor(name: string) {
    this.#name = name;
    this.setLevel("debug");
    channels.set(name, this);
    for (const listener of channelListeners) {
      listener();
    }
  }

  // fully qualified name for the logger
  public name(): string {
    return this.#name;
  }

  /**
   * Return true if the level would display when logged by the logger
   */
  public isLevelOn(level: LogLevel): boolean {
    return LEVELS.indexOf(level) <= this.#level;
  }

  /**
   * Set the allowed log level. Any log calls with severity "below" this one will be ignored.
   *
   * i.e. setting a level of "warn" will ignore any "info" or "debug" logs
   */
  public setLevel(level: LogLevel): void {
    this.#level = LEVELS.indexOf(level);
    LEVELS.forEach((name, i) => {
      this[name] = i <= this.#level ? console[name].bind(global.console) : noop;
    });
  }

  public debug(..._args: unknown[]): void {}
  public info(..._args: unknown[]): void {}
  public warn(..._args: unknown[]): void {}
  public error(..._args: unknown[]): void {}

  // create a new logger under this logger's namespace
  public getLogger(name: string): Logger {
    const shortName = name.replace(/^.+\.(asar|webpack)[\\/\\]/, "").replace(/^(\.\.\/)+/, "");
    const channelName = this.#name.length > 0 ? `${this.#name}.${shortName}` : shortName;
    return channels.get(channelName) ?? new Logger(channelName);
  }

  // get all logging channels
  public channels(): Logger[] {
    return Array.from(channels.values());
  }

  /** Calls `listener` whenever a channel is added. Returns a function that unsubscribes. */
  public onChannelAdded(listener: () => void): () => void {
    channelListeners.add(listener);
    return () => {
      channelListeners.delete(listener);
    };
  }
}

function toLogLevel(maybeLevel: string): LogLevel {
  return LEVELS.find((level) => level === maybeLevel) ?? "warn";
}

export default Logger.default;
export { Logger, toLogLevel };
export type { LogLevel };
