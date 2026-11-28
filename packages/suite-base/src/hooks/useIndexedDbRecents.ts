// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAsync } from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";
import { connectionRecentArgs } from "@lichtblick/suite-base/util/recentSources";

const log = Logger.getLogger(__filename);

const IDB_KEY = "recents";
const IDB_STORE = createKeyValueStore("lichtblick-recents", "recents");

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
  urls?: readonly string[];
};

type RecentFileRecord = RecentRecordCommon & {
  type: "file";
  // A string is a remote URL, in a comparison that mixes them with local files
  handles: (FileSystemFileHandle | string)[];
  // Side name of each of `handles` when they were compared side by side (see
  // FileDataSourceArgs.compare). A file in several sides repeats its handle. Missing: merged.
  compare?: string[];
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

  // True once the stored recents have been loaded into `recents`
  recentsLoaded: boolean;

  // Add a new recent (or move an existing matching one to the top). Returns the record id.
  addRecent: (newRecent: UnsavedRecentRecord) => string;

  removeRecent: (id: string) => void;

  togglePinRecent: (id: string) => void;

  // Remove all records that are not pinned
  clearRecents: () => void;

  // Save changes
  save: () => Promise<void>;
}

export function isSameRecent(a: UnsavedRecentRecord, b: UnsavedRecentRecord): boolean {
  if (a.type !== b.type || a.sourceId !== b.sourceId) {
    return false;
  }
  // Connections are identified by their arguments, files by name. A comparison also by which
  // file is in which side, since its title lists each file once.
  if (a.type === "connection" || b.type === "connection") {
    // The display name (`name`) isn't identity: a catalog name or a renamed entry reuses the row.
    if (a.type !== "connection" || b.type !== "connection") {
      return false;
    }
    const left = connectionRecentArgs(a);
    const right = connectionRecentArgs(b);
    return (
      _.isEqual(left.urls, right.urls) &&
      _.isEqual(_.omit(left.params, "name"), _.omit(right.params, "name"))
    );
  }
  const names = (r: typeof a) => r.handles.map((h) => (typeof h === "string" ? h : h.name));
  return (
    a.title === b.title &&
    _.isEqual(a.compare, b.compare) &&
    (a.compare == undefined || _.isEqual(names(a), names(b)))
  );
}

/** A change to the recents list, replayed onto the stored list when it is saved. */
type RecentsChange = (records: RecentRecord[]) => RecentRecord[];

/** Newest first: drop older duplicates and evict unpinned records beyond MAX_RECENTS. */
function normalizeRecents(records: readonly RecentRecord[]): RecentRecord[] {
  let unpinnedCount = 0;
  return _.uniqWith(records, isSameRecent).filter(
    (recent) => recent.pinned === true || ++unpinnedCount <= MAX_RECENTS,
  );
}

function applyChanges(records: RecentRecord[], changes: readonly RecentsChange[]): RecentRecord[] {
  return normalizeRecents(changes.reduce((list, change) => change(list), records));
}

function migrateStored(records: (RecentRecord & OldRecentRecord)[] | undefined): RecentRecord[] {
  for (const record of records ?? []) {
    if (record.type === "file" && record.handle) {
      // We don't have access to the file handles so we can't verify if the files still exist
      record.handles = [record.handle];
    }
  }
  return records ?? [];
}

/**
 * Recents shared by all tabs. Each edit is kept as a change and replayed onto the stored list in
 * one transaction, so a tab never overwrites what another tab added, pinned or removed meanwhile.
 */
function useIndexedDbRecents(): IRecentsStore {
  const {
    value: initialRecents,
    loading,
    error: loadError,
  } = useAsync(async () => await IDB_STORE.get<(RecentRecord & OldRecentRecord)[]>(IDB_KEY), []);

  const [recents, setRecents] = useState<RecentRecord[]>([]);
  const [recentsLoaded, setRecentsLoaded] = useState(false);

  // The list shown now: the last loaded or saved list plus the changes not saved yet
  const recentsRef = useRef<RecentRecord[]>([]);
  const unsavedRef = useRef<RecentsChange[]>([]);
  const writingRef = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback(async () => {
    // The stored list is read with each write, but not before it was loaded once: a failed load
    // means the store can't be read, and writing would replace all of it with this session's.
    if (loading || loadError != undefined) {
      return;
    }
    writingRef.current = writingRef.current
      .then(async () => {
        // Removed from the queue only once committed: a failed write is retried by the next save
        const changes = unsavedRef.current.slice();
        if (changes.length === 0) {
          return;
        }
        const store = await IDB_STORE.readwrite();
        // A failed get/put aborts the transaction and rejects `done` too, unawaited: handle it here
        store.transaction.done.catch(() => {});
        const stored = migrateStored(
          (await store.get(IDB_KEY)) as (RecentRecord & OldRecentRecord)[] | undefined,
        );
        const saved = applyChanges(stored, changes);
        await store.put(saved, IDB_KEY);
        await store.transaction.done;
        unsavedRef.current.splice(0, changes.length);
        recentsRef.current = applyChanges(saved, unsavedRef.current);
        setRecents(recentsRef.current);
      })
      .catch((err: unknown) => {
        log.error(err);
      });
    await writingRef.current;
  }, [loading, loadError]);

  // Show the stored recents once loaded, with any change made before that
  useLayoutEffect(() => {
    if (loading) {
      return;
    }
    recentsRef.current = applyChanges(migrateStored(initialRecents), unsavedRef.current);
    setRecents(recentsRef.current);
    setRecentsLoaded(true);
    void save();
  }, [loading, initialRecents, save]);

  const change = useCallback(
    (recentsChange: RecentsChange) => {
      unsavedRef.current.push(recentsChange);
      recentsRef.current = applyChanges(recentsRef.current, [recentsChange]);
      setRecents(recentsRef.current);
      void save();
    },
    [save],
  );

  const addRecent = useCallback(
    (record: UnsavedRecentRecord) => {
      // Re-opening an existing record keeps its id and pin. The stored record takes this id even
      // when another tab stored the same recent under its own id, so the id the caller keeps
      // (current recent, reopen after reload) is the one in storage.
      const id =
        recentsRef.current.find((recent) => isSameRecent(recent, record))?.id ?? randomUUID();
      change((list) => {
        const existing = list.find((recent) => isSameRecent(recent, record));
        return [{ ...record, id, pinned: existing?.pinned, lastOpened: Date.now() }, ...list];
      });
      return id;
    },
    [change],
  );

  // Another tab's addRecent may have stored the record under its own id since this tab loaded
  // it, so a change by id matches the stored records by what they are.
  const removeRecent = useCallback(
    (id: string) => {
      const shown = recentsRef.current.find((recent) => recent.id === id);
      if (shown) {
        change((list) => list.filter((recent) => !isSameRecent(recent, shown)));
      }
    },
    [change],
  );

  const togglePinRecent = useCallback(
    (id: string) => {
      const shown = recentsRef.current.find((recent) => recent.id === id);
      if (shown) {
        const pinned = shown.pinned !== true;
        change((list) =>
          list.map((recent) => (isSameRecent(recent, shown) ? { ...recent, pinned } : recent)),
        );
      }
    },
    [change],
  );

  const clearRecents = useCallback(() => {
    change((list) => list.filter((recent) => recent.pinned === true));
  }, [change]);

  return useMemo<IRecentsStore>(
    () => ({
      recents,
      recentsLoaded,
      addRecent,
      removeRecent,
      togglePinRecent,
      clearRecents,
      save,
    }),
    [addRecent, clearRecents, recents, recentsLoaded, removeRecent, save, togglePinRecent],
  );
}

export default useIndexedDbRecents;
