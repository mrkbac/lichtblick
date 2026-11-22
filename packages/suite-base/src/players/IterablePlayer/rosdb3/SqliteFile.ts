// SPDX-License-Identifier: MPL-2.0

import sqlite3InitModule, {
  type Database,
  type Sqlite3Result,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";

import { BlockCachedFile } from "./BlockCachedFile";

const VFS_NAME = "rosbag-file";
type Connection = { db: Database; capi: Sqlite3Static["capi"] };
let sqlite: ReturnType<typeof initialize> | undefined;

export async function openSqliteFile(file: File): Promise<Connection> {
  sqlite ??= initialize().catch((error: unknown) => {
    sqlite = undefined;
    throw error;
  });
  return (await sqlite).open(file);
}

async function initialize() {
  const { capi, oo1, wasm, vfs } = await sqlite3InitModule();
  let openingFile: BlockCachedFile | undefined;
  const files = new Map<number, BlockCachedFile>();
  // The runtime's struct binder prefixes C field names with "$".
  const io = Object.assign(new capi.sqlite3_io_methods(), { $iVersion: 1 });
  const fileVfs = new capi.sqlite3_vfs();
  fileVfs.$iVersion = 1;
  fileVfs.$szOsFile = capi.sqlite3_file.prototype.structInfo.sizeof;
  fileVfs.$mxPathname = 1024;
  vfs.installVfs({
    io: {
      struct: io,
      methods: {
        xClose(ptr) {
          files.delete(ptr);
          return capi.SQLITE_OK;
        },
        xRead(ptr, buffer, length, offset) {
          try {
            const out = wasm.heap8u().subarray(buffer, buffer + length);
            const read = files.get(ptr)!.readInto(out, Number(offset));
            if (read === length) {
              return capi.SQLITE_OK;
            }
            out.fill(0, read);
            return capi.SQLITE_IOERR_SHORT_READ;
          } catch {
            return capi.SQLITE_IOERR_READ;
          }
        },
        xFileSize(ptr, size) {
          wasm.poke64(size, files.get(ptr)!.size);
          return capi.SQLITE_OK;
        },
        xFileControl: () => capi.SQLITE_NOTFOUND,
        xDeviceCharacteristics: () => capi.SQLITE_IOCAP_IMMUTABLE as Sqlite3Result,
        xLock: () => capi.SQLITE_OK,
        xUnlock: () => capi.SQLITE_OK,
        xCheckReservedLock(_ptr, out) {
          wasm.poke32(out, 0);
          return capi.SQLITE_OK;
        },
      },
    },
    vfs: {
      struct: fileVfs,
      name: VFS_NAME,
      methods: {
        xOpen(_vfs, _name, ptr, flags, outFlags) {
          if (!openingFile || (flags & capi.SQLITE_OPEN_MAIN_DB) === 0) {
            return capi.SQLITE_CANTOPEN;
          }
          const file = new capi.sqlite3_file(ptr);
          file.$pMethods = io.pointer;
          file.dispose();
          files.set(ptr, openingFile);
          if (outFlags !== 0) {
            wasm.poke32(outFlags, capi.SQLITE_OPEN_READONLY);
          }
          return capi.SQLITE_OK;
        },
        xFullPathname(_vfs, name, length, out) {
          wasm.cstrncpy(out, name, length);
          return capi.SQLITE_OK;
        },
        xAccess(_vfs, _name, _flags, out) {
          // The selected File is immutable and has no journal or WAL sidecar.
          wasm.poke32(out, 0);
          return capi.SQLITE_OK;
        },
      },
    },
  });

  return {
    capi,
    open(file: File) {
      openingFile = new BlockCachedFile(file);
      let db;
      try {
        db = new oo1.DB("recording.db3", "r", VFS_NAME);
      } finally {
        openingFile = undefined;
      }
      try {
        db.exec("PRAGMA trusted_schema = OFF; PRAGMA temp_store = MEMORY");
        return { db, capi };
      } catch (error) {
        db.close();
        throw error;
      }
    },
  };
}
