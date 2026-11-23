// SPDX-License-Identifier: MPL-2.0
import "fake-indexeddb/auto";

import { deleteDB, openDB } from "idb";

import { forgetProfile, openProfile } from "./profile";

describe("Tailscale browser profile", () => {
  // Close connections even when an assertion fails, or deleteDB blocks.
  const opened: { close(): void }[] = [];
  const open = async () => {
    const profile = await openProfile();
    opened.push(profile);
    return profile;
  };
  afterEach(async () => {
    for (const profile of opened.splice(0)) {
      profile.close();
    }
    await deleteDB("lichtblick-tailscale");
  });

  it("restores the most recent device state on reopen and removes it on sign-out", async () => {
    const first = await open();
    first.storage.setState("profile", "first");
    first.storage.setState("machine", "example");
    first.storage.setState("profile", "second");
    await first.flush();
    first.close();

    const reopened = await open();
    expect(reopened.storage.getState("profile")).toBe("second");
    expect(reopened.storage.getState("machine")).toBe("example");
    reopened.storage.setState("profile", "pending");
    await reopened.clear();
    reopened.storage.setState("profile", "late callback");
    reopened.close();

    const fresh = await open();
    expect(fresh.storage.getState("profile")).toBe("");
    expect(fresh.storage.getState("machine")).toBe("");
    fresh.close();
  });

  it("keeps persisting writes after one storage write fails", async () => {
    const first = await open();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new Error("quota");
    });
    first.storage.setState("profile", "lost");
    await expect(first.flush()).rejects.toThrow("quota");
    await first.flush(); // retries the failed write
    expect((await open()).storage.getState("profile")).toBe("lost");
    first.storage.setState("profile", "recovered");
    await first.flush();
    first.close();
    expect((await open()).storage.getState("profile")).toBe("recovered");
  });

  it("can forget an unreadable device identity without decrypting it", async () => {
    const first = await open();
    first.storage.setState("machine", "example");
    await first.flush();
    first.close();
    const db = await openDB("lichtblick-tailscale");
    await db.delete("keys", "device");
    db.close();
    await expect(openProfile()).rejects.toThrow();
    await forgetProfile();
    const fresh = await open();
    expect(fresh.storage.getState("machine")).toBe("");
    fresh.close();
  });
});
