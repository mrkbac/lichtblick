// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import * as Comlink from "@foxglove/comlink";

import { processMessage, registerScript } from "./runtimeWorker/registry";
import generateRosLib from "./transformerWorker/generateRosLib";
import transform from "./transformerWorker/transform";

type Listener = (event: MessageEvent) => void;

// Two endpoints that deliver messages to each other synchronously, like a worker without the thread.
function createLinkedEndpoints(): [Comlink.Endpoint & { start: () => void }, Comlink.Endpoint] {
  const listeners = [new Set<Listener>(), new Set<Listener>()] as const;
  const endpoint = (self: 0 | 1) => ({
    postMessage: (data: unknown) => {
      for (const listener of listeners[self === 0 ? 1 : 0]) {
        listener({ data } as MessageEvent);
      }
    },
    addEventListener: (_type: string, listener: Listener) => listeners[self].add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners[self].delete(listener),
    start: () => {},
  });
  return [endpoint(0), endpoint(1)] as [Comlink.Endpoint & { start: () => void }, Comlink.Endpoint];
}

// One test class that implements both typescript compilation and message transformation.
export default class MockUserScriptPlayerWorker {
  public port: Comlink.Endpoint & { start: () => void };

  public constructor() {
    const [port1, port2] = createLinkedEndpoints();
    this.port = port1;

    const logged =
      <Args extends unknown[], R>(action: string, impl: (...args: Args) => R) =>
      (...args: Args): R => {
        this.messageSpy(action);
        return impl(...args);
      };
    Comlink.expose(
      {
        onError: () => {},
        close: () => {},
        generateRosLib: logged("generateRosLib", generateRosLib),
        transform: logged("transform", transform),
        registerScript: logged("registerScript", registerScript),
        processMessage: logged("processMessage", processMessage),
      },
      port2,
    );
  }

  // So tests can spy on what gets called
  public messageSpy(_action: string): void {
    // no-op
  }
}
