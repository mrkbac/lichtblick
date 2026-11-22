// SPDX-License-Identifier: MPL-2.0
import "fake-indexeddb/auto";

import { deleteDB, openDB } from "idb";

import { forgetProfile, openProfile } from "./profile";

describe("Tailscale browser profile", () => {
  afterEach(async () => {
    await deleteDB("lichtblick-tailscale");
  });

  it("restores the most recent device state on reopen and removes it on sign-out", async () => {
    const first = await openProfile();
    first.storage.setState("profile", "first");
    first.storage.setState("machine", "example");
    first.storage.setState("profile", "second");
    await first.flush();
    first.close();

    const reopened = await openProfile();
    expect(reopened.storage.getState("profile")).toBe("second");
    expect(reopened.storage.getState("machine")).toBe("example");
    reopened.storage.setState("profile", "pending");
    await reopened.clear();
    reopened.storage.setState("profile", "late callback");
    reopened.close();

    const fresh = await openProfile();
    expect(fresh.storage.getState("profile")).toBe("");
    expect(fresh.storage.getState("machine")).toBe("");
    fresh.close();
  });

  it("can forget an unreadable device identity without decrypting it", async () => {
    const first = await openProfile();
    first.storage.setState("machine", "example");
    await first.flush();
    first.close();
    const db = await openDB("lichtblick-tailscale");
    await db.delete("keys", "device");
    db.close();
    await expect(openProfile()).rejects.toThrow();
    await forgetProfile();
    const fresh = await openProfile();
    expect(fresh.storage.getState("machine")).toBe("");
    fresh.close();
  });
});
