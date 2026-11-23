/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import { useOnline, useVisibilityState } from "@lichtblick/hooks";
import { UserProfileStorageContext } from "@lichtblick/suite-base/context/UserProfileStorageContext";
import LayoutManagerProvider, {
  CHANGES_CHANNEL_NAME,
  nextSyncDelayMs,
  SYNC_LOCK_NAME,
} from "@lichtblick/suite-base/providers/LayoutManagerProvider";
import { ILayoutStorage } from "@lichtblick/suite-base/services/ILayoutStorage";
import { IRemoteLayoutStorage } from "@lichtblick/suite-base/services/IRemoteLayoutStorage";
import LayoutManager from "@lichtblick/suite-base/services/LayoutManager/LayoutManager";
import MockLayoutManager from "@lichtblick/suite-base/services/LayoutManager/MockLayoutManager";

// Mock dependencies
vi.mock("@lichtblick/hooks");

const mockLayoutManager = new MockLayoutManager();
const layoutStorage = {} as ILayoutStorage;
const remote = {} as IRemoteLayoutStorage;

vi.mock("@lichtblick/suite-base/services/LayoutManager/LayoutManager", () => ({
  default: vi.fn(function () {
    return mockLayoutManager;
  }),
}));

describe("LayoutManagerProvider", () => {
  // Mock necessary hooks to render <LayoutManagerProvider local={layoutStorage} remote={remote} /> component, otherwise it will fail
  (useOnline as Mock).mockReturnValue(true);
  (useVisibilityState as Mock).mockReturnValue("visible");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call layoutManager.setOnline accordingly with useOnline", async () => {
    (useOnline as Mock).mockReturnValueOnce(false);

    // 1 render with true and another with false.
    render(<LayoutManagerProvider local={layoutStorage} remote={remote} />);
    render(<LayoutManagerProvider local={layoutStorage} remote={remote} />);

    await waitFor(() => {
      expect(mockLayoutManager.setOnline).toHaveBeenCalledTimes(2);
      expect(mockLayoutManager.setOnline).toHaveBeenCalledWith({ online: true });
      expect(mockLayoutManager.setOnline).toHaveBeenCalledWith({ online: false });
    });
  });

  it("should call layoutManager.syncWithRemote", async () => {
    render(<LayoutManagerProvider local={layoutStorage} remote={remote} />);

    await waitFor(() => {
      expect(mockLayoutManager.syncWithRemote).toHaveBeenCalledTimes(1);
    });
  });

  it("should not call layoutManager.syncWithRemote if offline", async () => {
    (useOnline as Mock).mockReturnValueOnce(false);

    render(<LayoutManagerProvider local={layoutStorage} remote={remote} />);

    await waitFor(() => {
      expect(mockLayoutManager.syncWithRemote).toHaveBeenCalledTimes(0);
    });
  });

  it("should not call layoutManager.syncWithRemote if not visible", async () => {
    (useVisibilityState as Mock).mockReturnValueOnce("invisible");

    render(<LayoutManagerProvider local={layoutStorage} remote={remote} />);

    await waitFor(() => {
      expect(mockLayoutManager.syncWithRemote).toHaveBeenCalledTimes(0);
    });
  });

  it("should not call layoutManager.syncWithRemote if there is not remote storage", async () => {
    render(<LayoutManagerProvider local={layoutStorage} />);

    await waitFor(() => {
      expect(mockLayoutManager.syncWithRemote).toHaveBeenCalledTimes(0);
    });
  });

  it("should give the favorites storages to the layout manager and load favorites", () => {
    // Given
    const userProfile = { getUserProfile: vi.fn(), setUserProfile: vi.fn() };
    const remoteFavorites = {
      getFavoriteLayoutIds: vi.fn(),
      addFavoriteLayout: vi.fn(),
      removeFavoriteLayout: vi.fn(),
    };

    // When
    render(
      <UserProfileStorageContext.Provider value={userProfile}>
        <LayoutManagerProvider
          local={layoutStorage}
          remote={remote}
          remoteFavorites={remoteFavorites}
        />
      </UserProfileStorageContext.Provider>,
    );

    // Then
    expect(vi.mocked(LayoutManager)).toHaveBeenCalledWith(
      expect.objectContaining({ userProfile, remoteFavorites }),
    );
    expect(mockLayoutManager.loadFavorites).toHaveBeenCalled();
  });

  it("waits about two minutes between successful syncs and backs off after failures", () => {
    expect(nextSyncDelayMs(0, 0)).toBe(108_000);
    expect(nextSyncDelayMs(0, 1)).toBe(132_000);
    expect(nextSyncDelayMs(1, 0.5)).toBe(30_000);
    expect(nextSyncDelayMs(10, 1)).toBe(120_000);
  });

  describe("across tabs", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete (navigator as { locks?: unknown }).locks;
      mockLayoutManager.on.mockReset();
      mockLayoutManager.emitChange.mockReset();
    });

    it("syncs only while holding the sync lock", async () => {
      let grant: (() => Promise<void>) | undefined;
      const request = vi.fn(
        async (_name: string, _options: unknown, callback: () => Promise<void>) => {
          grant = callback;
          await new Promise<void>(() => {});
        },
      );
      Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });

      render(<LayoutManagerProvider local={layoutStorage} remote={remote} />);

      expect(request).toHaveBeenCalledWith(SYNC_LOCK_NAME, expect.anything(), expect.any(Function));
      await Promise.resolve();
      expect(mockLayoutManager.syncWithRemote).not.toHaveBeenCalled();

      void grant!();
      await waitFor(() => {
        expect(mockLayoutManager.syncWithRemote).toHaveBeenCalledTimes(1);
      });
    });

    it("posts local changes to other tabs and replays theirs without echoing them", () => {
      const channels: FakeChannel[] = [];
      class FakeChannel {
        public onmessage: ((event: MessageEvent) => void) | undefined;
        public posted: unknown[] = [];
        public constructor(public name: string) {
          channels.push(this);
        }
        public postMessage(message: unknown) {
          this.posted.push(message);
        }
        public close() {}
      }
      vi.stubGlobal("BroadcastChannel", FakeChannel);
      const listeners: ((event: unknown) => void)[] = [];
      mockLayoutManager.on.mockImplementation((name: string, listener: (e: unknown) => void) => {
        if (name === "change") {
          listeners.push(listener);
        }
      });
      // Like the real manager, emitChange calls the listeners synchronously.
      mockLayoutManager.emitChange.mockImplementation((event: unknown) => {
        listeners.forEach((listener) => {
          listener(event);
        });
      });

      render(<LayoutManagerProvider local={layoutStorage} remote={remote} />);
      const channel = channels.find((c) => c.name === CHANGES_CHANNEL_NAME)!;

      const local = { type: "change", updatedLayout: undefined };
      listeners.forEach((listener) => {
        listener(local);
      });
      expect(channel.posted).toEqual([local]);

      const fromOtherTab = { type: "delete", layoutId: "a" };
      channel.onmessage!({ data: fromOtherTab } as MessageEvent);
      expect(mockLayoutManager.emitChange).toHaveBeenCalledWith(fromOtherTab);
      expect(channel.posted).toEqual([local]);
    });
  });
});
