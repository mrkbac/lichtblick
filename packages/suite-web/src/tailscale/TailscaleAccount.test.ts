// SPDX-License-Identifier: MPL-2.0

import { prepareTailscaleTransport } from "./TailscaleAccount";
import type { SessionStatus } from "./worker";

const { dispose, callbacks } = vi.hoisted(() => ({
  dispose: vi.fn(),
  callbacks: [] as ((status: SessionStatus) => void)[],
}));
vi.mock("./TailscaleBackend", () => ({
  TailscaleBackend: class {
    public dispose = dispose;
    public constructor(notify: (status: SessionStatus) => void) {
      callbacks.push(notify);
    }
  },
}));
vi.mock("@lichtblick/suite-base/i18n", () => ({ sharedI18nObject: { t: (key: string) => key } }));

beforeEach(() => {
  dispose.mockClear();
  callbacks.length = 0;
});

it("reopens a saved device when its browser identity becomes ready", async () => {
  const pending = prepareTailscaleTransport(new AbortController().signal);
  callbacks[0]!({ state: "Running", peers: [] });
  const backend = await pending;
  expect(backend.dispose).toBe(dispose);
  callbacks[0]!({ state: "NeedsLogin", peers: [] });
  expect(dispose).not.toHaveBeenCalled();
});

it("releases a cancelled connection while the shared node starts", async () => {
  const controller = new AbortController();
  const pending = prepareTailscaleTransport(controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  callbacks[0]!({ state: "Running", peers: [] });
  expect(dispose).toHaveBeenCalledOnce();
});

it("directs a signed-out recent connection to the profile menu", async () => {
  const pending = prepareTailscaleTransport(new AbortController().signal);
  callbacks[0]!({ state: "NeedsLogin", peers: [] });
  await expect(pending).rejects.toThrow("tailscaleProfileLogin");
  expect(dispose).toHaveBeenCalledOnce();
});
