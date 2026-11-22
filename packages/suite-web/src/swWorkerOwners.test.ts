/** @jest-environment jsdom */
// SPDX-License-Identifier: MPL-2.0

// public/sw-worker-owners.js runs in the service worker; here `self` is the jsdom window, with
// fakes for the service worker's clients, registration and Cache Storage.

type FakeClient = { id: string; type: string };
type OwningWindow = (clientId: string) => Promise<FakeClient | undefined>;

const liveClients = new Map<string, FakeClient>();
const stored = new Map<string, Response>();
const fakeCache = {
  put: async (key: string, response: Response) => {
    stored.set(key, response);
  },
  match: async (key: string | Request) => {
    const url = typeof key === "string" ? key : key.url;
    return stored.get(url)?.clone();
  },
  keys: async () => [...stored.keys()].map((url) => ({ url })),
  delete: async (key: { url: string }) => stored.delete(key.url),
};

function addClient(id: string, type: string) {
  liveClients.set(id, { id, type });
}

/** Dispatches a worker's script request; resolves once the owner is stored. */
async function workerScriptFetch(creator: string, worker: string): Promise<void> {
  const pending: Promise<unknown>[] = [];
  self.dispatchEvent(
    Object.assign(new Event("fetch"), {
      request: { destination: "worker" },
      clientId: creator,
      resultingClientId: worker,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    }),
  );
  await Promise.all(pending);
}

/** A fresh copy of the script, as after the browser restarts the idle service worker. */
async function startServiceWorker(): Promise<OwningWindow> {
  vi.resetModules();
  // @ts-expect-error plain script without types
  await import("../public/sw-worker-owners.js");
  return (self as unknown as { lichtblickOwningWindow: OwningWindow }).lichtblickOwningWindow;
}

describe("sw-worker-owners.js", () => {
  beforeAll(() => {
    Object.assign(self, {
      registration: { scope: "https://example.com/" },
      caches: { open: async () => fakeCache },
      clients: {
        get: async (id: string) => liveClients.get(id),
        matchAll: async () => [...liveClients.values()],
      },
    });
  });
  beforeEach(() => {
    liveClients.clear();
    stored.clear();
    addClient("page", "window");
  });

  it("finds the window behind a worker's request, through nested workers", async () => {
    const owningWindow = await startServiceWorker();
    addClient("decoder", "worker");
    addClient("nested", "worker");
    await workerScriptFetch("page", "decoder");
    await workerScriptFetch("decoder", "nested");
    await expect(owningWindow("decoder")).resolves.toMatchObject({ id: "page" });
    await expect(owningWindow("nested")).resolves.toMatchObject({ id: "page" });
    await expect(owningWindow("page")).resolves.toMatchObject({ id: "page" });
  });

  it("still knows the owner after the service worker restarts", async () => {
    addClient("decoder", "worker");
    await workerScriptFetch("page", "decoder");
    const restarted = await startServiceWorker();
    await expect(restarted("decoder")).resolves.toMatchObject({ id: "page" });
  });

  it("returns undefined for a worker it never saw created", async () => {
    const owningWindow = await startServiceWorker();
    addClient("orphan", "worker");
    await expect(owningWindow("orphan")).resolves.toBeUndefined();
  });

  it("forgets workers that are gone, but not one created a moment ago", async () => {
    await startServiceWorker();
    vi.useFakeTimers();
    addClient("old", "worker");
    await workerScriptFetch("page", "old");
    liveClients.delete("old"); // the worker ended
    vi.advanceTimersByTime(120_000);
    // "fresh" isn't listed by clients.matchAll yet
    await workerScriptFetch("page", "fresh");
    vi.useRealTimers();
    expect([...stored.keys()]).toEqual(["https://example.com/__worker-owner/fresh"]);
  });
});
