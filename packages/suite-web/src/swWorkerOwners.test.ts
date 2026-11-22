/** @jest-environment jsdom */
// SPDX-License-Identifier: MPL-2.0

// public/sw-worker-owners.js runs in the service worker; here `self` is the jsdom window.

type FakeClient = { id: string; type: string };
type OwningWindow = (clientId: string) => Promise<FakeClient | undefined>;

const clientsById = new Map<string, FakeClient>([
  ["page", { id: "page", type: "window" }],
  ["decoder", { id: "decoder", type: "worker" }],
  ["nested", { id: "nested", type: "worker" }],
  ["orphan", { id: "orphan", type: "worker" }],
]);

function workerScriptFetch(creator: string, worker: string) {
  self.dispatchEvent(
    Object.assign(new Event("fetch"), {
      request: { destination: "worker" },
      clientId: creator,
      resultingClientId: worker,
    }),
  );
}

describe("sw-worker-owners.js", () => {
  let owningWindow: OwningWindow;

  beforeAll(async () => {
    Object.assign(self, { clients: { get: async (id: string) => clientsById.get(id) } });
    // @ts-expect-error plain script without types
    await import("../public/sw-worker-owners.js");
    owningWindow = (self as unknown as { lichtblickOwningWindow: OwningWindow })
      .lichtblickOwningWindow;
  });

  it("finds the window behind a worker's request, through nested workers", async () => {
    workerScriptFetch("page", "decoder");
    workerScriptFetch("decoder", "nested");
    await expect(owningWindow("decoder")).resolves.toMatchObject({ id: "page" });
    await expect(owningWindow("nested")).resolves.toMatchObject({ id: "page" });
  });

  it("returns a window's own request as is", async () => {
    await expect(owningWindow("page")).resolves.toMatchObject({ id: "page" });
  });

  it("returns undefined for a worker it never saw created", async () => {
    await expect(owningWindow("orphan")).resolves.toBeUndefined();
  });
});
