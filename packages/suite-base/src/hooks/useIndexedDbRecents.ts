// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { set as idbSet, get as idbGet, createStore as idbCreateStore } from "idb-keyval";
import * as _ from "lodash-es";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAsync } from "react-use";
import { v4 as uuid } from "uuid";

import Logger from "@lichtblick/log";
import { KEY_WORKSPACE_PREFIX } from "@lichtblick/suite-base/constants/browserStorageKeys";

const log = Logger.getLogger(__filename);

const IDB_KEY = "recents";
const IDB_STORE = idbCreateStore(`${KEY_WORKSPACE_PREFIX}lichtblick-recents`, "recents");

// Maximum number of unpinned recents to keep
export const MAX_RECENTS = 100;

type RecentRecordCommon = {
  // Record id - use IndexedDbRecentsStore.GenerateRecordId() to generate
  id: string;

  // The source id
  sourceId: string;

  // The primary text for the recent record
  title: string;

  // Optional label for the recent record
  label?: string;

  // Epoch milliseconds of the last time this record was opened
  lastOpened?: number;

  // Pinned records are listed first and never evicted
  pinned?: boolean;
};

type RecentConnectionRecord = RecentRecordCommon & {
  type: "connection";
  // Optional arguments stored with the recent entry
  extra?: Record<string, string | undefined>;
};

type RecentFileRecord = RecentRecordCommon & {
  type: "file";
  handles: FileSystemFileHandle[]; // foxglove-depcheck-used: @types/wicg-file-system-access
};

// Make sure users with old recents can still use them
type OldRecentRecord = {
  handle?: FileSystemFileHandle;
};

type UnsavedRecentRecord = Omit<RecentConnectionRecord, "id"> | Omit<RecentFileRecord, "id">;

export type RecentRecord = RecentConnectionRecord | RecentFileRecord;

interface IRecentsStore {
  // Recent records
  recents: RecentRecord[];

  // Add a new recent (or move an existing matching one to the top). Returns the record id.
  addRecent: (newRecent: UnsavedRecentRecord) => string;

  removeRecent: (id: string) => void;

  togglePinRecent: (id: string) => void;

  // Remove all records that are not pinned
  clearRecents: () => void;

  // Save changes
  save: () => Promise<void>;
}

function isSameRecent(a: UnsavedRecentRecord, b: UnsavedRecentRecord): boolean {
  if (a.type !== b.type || a.sourceId !== b.sourceId) {
    return false;
  }
  // Connections are identified by their arguments, files by name
  if (a.type === "connection" && b.type === "connection") {
    return _.isEqual(a.extra, b.extra);
  }
  return a.title === b.title;
}

function useIndexedDbRecents(): IRecentsStore {
  const { value: initialRecents, loading } = useAsync(
    async () => await idbGet<(RecentRecord & OldRecentRecord)[] | undefined>(IDB_KEY, IDB_STORE),
    [],
  );

  const [recents, setRecents] = useState<RecentRecord[]>([]);

  // Track new recents in a ref and update the state after persisting
  const newRecentsRef = useRef<RecentRecord[]>([]);

  const save = useCallback(async () => {
    // We don't save until we've loaded our existing recents. This ensures we include stored recents when we save
    if (loading) {
      return;
    }

    // Records are kept newest first; drop older duplicates and evict beyond MAX_RECENTS
    let unpinnedCount = 0;
    const recentsToSave = _.uniqWith(newRecentsRef.current, isSameRecent).filter(
      (recent) => recent.pinned === true || ++unpinnedCount <= MAX_RECENTS,
    );
    newRecentsRef.current = recentsToSave;

    setRecents(recentsToSave);
    idbSet(IDB_KEY, recentsToSave, IDB_STORE).catch((err: unknown) => {
      log.error(err);
    });
  }, [loading]);

  // Set the first load records from the store to the state
  useLayoutEffect(() => {
    if (loading) {
      return;
    }

    const haveUnsavedRecents = newRecentsRef.current.length > 0;

    if (initialRecents) {
      for (const initialRecent of initialRecents) {
        if (initialRecent.type === "file" && initialRecent.handle) {
          // We don't have access to the file handles so we can't verify if the files still exist
          initialRecent.handles = [initialRecent.handle];
        }
      }

      newRecentsRef.current.push(...initialRecents);
    }

    if (haveUnsavedRecents) {
      void save();
    } else {
      // No new recents by the time we loaded our initial recents so we don't need to save
      // Normally a save invokes set - but since we don't need to save we set here
      setRecents(newRecentsRef.current);
    }
  }, [loading, initialRecents, save]);

  const addRecent = useCallback(
    (record: UnsavedRecentRecord) => {
      // Re-opening an existing record keeps its id and pin
      const existing = newRecentsRef.current.find((recent) => isSameRecent(recent, record));
      const fullRecord: RecentRecord = {
        ...record,
        id: existing?.id ?? uuid(),
        pinned: existing?.pinned,
        lastOpened: Date.now(),
      };
      newRecentsRef.current.unshift(fullRecord);
      void save();
      return fullRecord.id;
    },
    [save],
  );

  const removeRecent = useCallback(
    (id: string) => {
      newRecentsRef.current = newRecentsRef.current.filter((recent) => recent.id !== id);
      void save();
    },
    [save],
  );

  const togglePinRecent = useCallback(
    (id: string) => {
      newRecentsRef.current = newRecentsRef.current.map((recent) =>
        recent.id === id ? { ...recent, pinned: recent.pinned !== true } : recent,
      );
      void save();
    },
    [save],
  );

  const clearRecents = useCallback(() => {
    newRecentsRef.current = newRecentsRef.current.filter((recent) => recent.pinned === true);
    void save();
  }, [save]);

  return useMemo<IRecentsStore>(
    () => ({
      recents,
      addRecent,
      removeRecent,
      togglePinRecent,
      clearRecents,
      save,
    }),
    [addRecent, clearRecents, recents, removeRecent, save, togglePinRecent],
  );
}

export default useIndexedDbRecents;
