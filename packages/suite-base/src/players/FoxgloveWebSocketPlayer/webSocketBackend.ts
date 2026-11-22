// SPDX-License-Identifier: MPL-2.0

import type { IWebSocket } from "@foxglove/ws-protocol";

import type { LiveConnectionBackend } from "@lichtblick/suite-base/players/LiveConnectionBackend";

import ExtensionProxySocket, { needsExtensionProxy } from "./ExtensionProxySocket";
import WorkerSocketAdapter from "./WorkerSocketAdapter";

export const webSocketBackend: LiveConnectionBackend = {
  open(url, protocols) {
    if (needsExtensionProxy(url)) {
      return new ExtensionProxySocket(url, protocols);
    }
    if (typeof Worker !== "undefined") {
      return new WorkerSocketAdapter(url, protocols);
    }
    return new WebSocket(url, protocols) as IWebSocket;
  },
};
