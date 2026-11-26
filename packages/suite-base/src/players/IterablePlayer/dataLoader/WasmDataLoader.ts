// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Host for data loaders built against the public `foxglove:loader@0.1.0` WIT world (vendored as
// loader.wit), e.g. with Foxglove's `foxglove_data_loader` Rust crate or C++ SDK, for
// wasm32-unknown-unknown or wasm32-wasip1. Such a .wasm is a core module whose imports and exports
// follow the component model's canonical ABI, so this file lifts and lowers exactly the types of
// that one interface by hand instead of pulling in a component runtime.

import { wasiImports } from "./wasi";

const LOADER = "foxglove:loader/loader@0.1.0";
const EXPORTED = `[export]${LOADER}`;

/** A file the loader can read synchronously, e.g. a BlockCachedFile in a worker. */
export type SyncFile = {
  size: number;
  /** Copies bytes from `offset` into `out` and returns how many it copied. */
  readInto(out: Uint8Array, offset: number): number;
};

/**
 * Paths the loader opens files by: each file name, or `<n>/<name>` for a later file whose name is
 * taken, so same-named files from different folders all reach the loader with their extension.
 */
export function uniqueFilePaths(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let filePath = name;
    for (let n = 2; taken.has(filePath); n++) {
      filePath = `${n}/${name}`;
    }
    taken.add(filePath);
    return filePath;
  });
}

export type LoaderChannel = {
  id: number;
  schemaId: number | undefined;
  topicName: string;
  messageEncoding: string;
  messageCount: bigint | undefined;
};

export type LoaderSchema = {
  id: number;
  name: string;
  encoding: string;
  data: Uint8Array;
};

export type LoaderProblem = {
  severity: "info" | "warn" | "error";
  message: string;
  tip: string | undefined;
};

export type LoaderInitialization = {
  channels: LoaderChannel[];
  schemas: LoaderSchema[];
  startTime: bigint;
  endTime: bigint;
  problems: LoaderProblem[];
};

export type LoaderMessage = {
  channelId: number;
  logTime: bigint;
  publishTime: bigint;
  data: Uint8Array;
};

type Exports = {
  memory: WebAssembly.Memory;
  cabi_realloc: (oldPtr: number, oldSize: number, align: number, newSize: number) => number;
  [name: string]: unknown;
};
type Fn = (...args: (number | bigint)[]) => number;

const SEVERITIES = ["info", "warn", "error"] as const;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/** Handles for resources the guest exports (data-loader, message-iterator) point at its own reps. */
class HandleTable<T> {
  #next = 1;
  readonly #items = new Map<number, T>();
  public add(item: T): number {
    const handle = this.#next++;
    this.#items.set(handle, item);
    return handle;
  }
  public get(handle: number): T {
    const item = this.#items.get(handle);
    if (item == undefined) {
      throw new Error(`Data loader used an unknown resource handle ${handle}`);
    }
    return item;
  }
  public remove(handle: number): T {
    const item = this.get(handle);
    this.#items.delete(handle);
    return item;
  }
}

type OpenFile = { file: SyncFile; pos: number };

export class WasmDataLoader {
  readonly #exports: Exports;
  readonly #loaderHandle: number;
  readonly #reps: HandleTable<number>;

  private constructor(exports: Exports, reps: HandleTable<number>, paths: string[]) {
    this.#exports = exports;
    this.#reps = reps;
    this.#loaderHandle = this.#call("[constructor]data-loader", ...this.#lowerStrings(paths));
  }

  /** Instantiates the module and constructs its data loader for `files` (keyed by path). */
  public static async create(
    wasm: BufferSource | WebAssembly.Module,
    files: ReadonlyMap<string, SyncFile>,
    log: {
      info(msg: string): void;
      warn(msg: string): void;
      error(msg: string): void;
    },
  ): Promise<WasmDataLoader> {
    const reps = new HandleTable<number>();
    const readers = new HandleTable<OpenFile>();
    // Filled in after instantiation; imports only run once the module is running
    const instance: { exports?: Exports } = {};
    const mem = () => instance.exports!.memory.buffer;
    const str = (ptr: number, len: number) => textDecoder.decode(new Uint8Array(mem(), ptr, len));
    const dtor = (resource: string) => (handle: number) => {
      (instance.exports![`${LOADER}#[dtor]${resource}`] as Fn)(reps.remove(handle));
    };

    const imports: WebAssembly.Imports = {
      [EXPORTED]: {
        "[resource-new]data-loader": (rep: number) => reps.add(rep),
        "[resource-new]message-iterator": (rep: number) => reps.add(rep),
        "[resource-rep]data-loader": (handle: number) => reps.get(handle),
        "[resource-rep]message-iterator": (handle: number) => reps.get(handle),
        "[resource-drop]data-loader": dtor("data-loader"),
        "[resource-drop]message-iterator": dtor("message-iterator"),
      },
      "foxglove:loader/console@0.1.0": {
        log: (ptr: number, len: number) => {
          log.info(str(ptr, len));
        },
        warn: (ptr: number, len: number) => {
          log.warn(str(ptr, len));
        },
        error: (ptr: number, len: number) => {
          log.error(str(ptr, len));
        },
      },
      "foxglove:loader/reader@0.1.0": {
        open: (ptr: number, len: number) => {
          const path = str(ptr, len);
          const file = files.get(path);
          if (!file) {
            throw new Error(`Data loader opened unknown path ${path}`);
          }
          return readers.add({ file, pos: 0 });
        },
        "[method]reader.seek": (handle: number, pos: bigint) => {
          const reader = readers.get(handle);
          reader.pos = Math.min(Number(pos), reader.file.size);
          return BigInt(reader.pos);
        },
        "[method]reader.position": (handle: number) => BigInt(readers.get(handle).pos),
        "[method]reader.size": (handle: number) => BigInt(readers.get(handle).file.size),
        "[method]reader.read": (handle: number, ptr: number, len: number) => {
          const reader = readers.get(handle);
          const n = reader.file.readInto(new Uint8Array(mem(), ptr, len), reader.pos);
          reader.pos += n;
          return BigInt(n);
        },
        "[resource-drop]reader": (handle: number) => {
          readers.remove(handle);
        },
      },
      wasi_snapshot_preview1: wasiImports(mem, log),
    };

    const module = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm);
    const missing = WebAssembly.Module.imports(module).filter(
      ({ module: mod, name }) =>
        (imports[mod] as Record<string, unknown> | undefined)?.[name] == undefined,
    );
    if (missing.length > 0) {
      throw new Error(
        `Unsupported data loader: it imports ${missing.map((i) => `${i.module}.${i.name}`).join(", ")}`,
      );
    }
    instance.exports = (await WebAssembly.instantiate(module, imports)).exports as Exports;
    // WASI reactors (e.g. C++ loaders) set up their runtime here before any other call
    // eslint-disable-next-line no-underscore-dangle -- the export name WASI defines
    (instance.exports._initialize as Fn | undefined)?.();
    return new WasmDataLoader(instance.exports, reps, [...files.keys()]);
  }

  public initialize(): LoaderInitialization {
    const self = this.#reps.get(this.#loaderHandle);
    return this.#callResult("[method]data-loader.initialize", 8, self, (p) => ({
      channels: this.#list(p, 40, (c) => ({
        id: this.#dv().getUint16(c, true),
        schemaId: this.#dv().getUint8(c + 2) === 1 ? this.#dv().getUint16(c + 4, true) : undefined,
        topicName: this.#string(c + 8),
        messageEncoding: this.#string(c + 16),
        messageCount:
          this.#dv().getUint8(c + 24) === 1 ? this.#dv().getBigUint64(c + 32, true) : undefined,
      })),
      schemas: this.#list(p + 8, 28, (s) => ({
        id: this.#dv().getUint16(s, true),
        name: this.#string(s + 4),
        encoding: this.#string(s + 12),
        data: this.#bytes(s + 20),
      })),
      startTime: this.#dv().getBigUint64(p + 16, true),
      endTime: this.#dv().getBigUint64(p + 24, true),
      problems: this.#list(p + 32, 24, (q) => ({
        severity: SEVERITIES[this.#dv().getUint8(q)] ?? "error",
        message: this.#string(q + 4),
        tip: this.#dv().getUint8(q + 12) === 1 ? this.#string(q + 16) : undefined,
      })),
    }));
  }

  /** Messages on `channels` between `start` and `end` (inclusive, nanoseconds), in log time order. */
  public *messages(args: {
    channels: number[];
    start?: bigint;
    end?: bigint;
  }): Generator<LoaderMessage, void, undefined> {
    const iterHandle = this.#callResult(
      "[method]data-loader.create-iterator",
      4,
      this.#reps.get(this.#loaderHandle),
      (p) => this.#dv().getInt32(p, true),
      args.start == undefined ? 0 : 1,
      args.start ?? 0n,
      args.end == undefined ? 0 : 1,
      args.end ?? 0n,
      ...this.#lowerU16s(args.channels),
    );
    const name = "[method]message-iterator.next";
    try {
      for (;;) {
        const ret = this.#call(name, this.#reps.get(iterHandle));
        let message: LoaderMessage | undefined;
        try {
          if (this.#dv().getUint8(ret) === 1) {
            if (this.#dv().getUint8(ret + 8) === 1) {
              throw new Error(this.#string(ret + 16));
            }
            message = this.#message(ret + 16);
          }
        } finally {
          this.#postReturn(name, ret);
        }
        if (!message) {
          return;
        }
        yield message;
      }
    } finally {
      (this.#exports[`${LOADER}#[dtor]message-iterator`] as Fn)(this.#reps.remove(iterHandle));
    }
  }

  /** The latest message at or before `time` on each of `channels`. */
  public backfill(time: bigint, channels: number[]): LoaderMessage[] {
    return this.#callResult(
      "[method]data-loader.get-backfill",
      4,
      this.#reps.get(this.#loaderHandle),
      (p) => this.#list(p, 32, (m) => this.#message(m)),
      time,
      ...this.#lowerU16s(channels),
    );
  }

  #dv(): DataView {
    return new DataView(this.#exports.memory.buffer);
  }

  #string(ptr: number): string {
    const view = this.#dv();
    return textDecoder.decode(
      new Uint8Array(view.buffer, view.getUint32(ptr, true), view.getUint32(ptr + 4, true)),
    );
  }

  #bytes(ptr: number): Uint8Array {
    const view = this.#dv();
    const start = view.getUint32(ptr, true);
    return new Uint8Array(view.buffer.slice(start, start + view.getUint32(ptr + 4, true)));
  }

  #list<T>(ptr: number, size: number, lift: (elementPtr: number) => T): T[] {
    const base = this.#dv().getUint32(ptr, true);
    const length = this.#dv().getUint32(ptr + 4, true);
    return Array.from({ length }, (_, i) => lift(base + i * size));
  }

  #message(ptr: number): LoaderMessage {
    return {
      channelId: this.#dv().getUint16(ptr, true),
      logTime: this.#dv().getBigUint64(ptr + 8, true),
      publishTime: this.#dv().getBigUint64(ptr + 16, true),
      data: this.#bytes(ptr + 24),
    };
  }

  #alloc(align: number, size: number): number {
    return this.#exports.cabi_realloc(0, 0, align, size);
  }

  #lowerU16s(values: number[]): [number, number] {
    const ptr = this.#alloc(2, values.length * 2);
    const view = this.#dv();
    values.forEach((value, i) => {
      view.setUint16(ptr + i * 2, value, true);
    });
    return [ptr, values.length];
  }

  #lowerStrings(values: string[]): [number, number] {
    const ptr = this.#alloc(4, values.length * 8);
    values.forEach((value, i) => {
      const encoded = textEncoder.encode(value);
      const strPtr = this.#alloc(1, encoded.byteLength);
      new Uint8Array(this.#exports.memory.buffer, strPtr, encoded.byteLength).set(encoded);
      const view = this.#dv();
      view.setUint32(ptr + i * 8, strPtr, true);
      view.setUint32(ptr + i * 8 + 4, encoded.byteLength, true);
    });
    return [ptr, values.length];
  }

  #call(name: string, ...args: (number | bigint)[]): number {
    return (this.#exports[`${LOADER}#${name}`] as Fn)(...args);
  }

  #postReturn(name: string, ret: number): void {
    (this.#exports[`cabi_post_${LOADER}#${name}`] as Fn | undefined)?.(ret);
  }

  /** Calls an export returning `result<T, string>`, whose payload sits `payloadOffset` bytes in. */
  #callResult<T>(
    name: string,
    payloadOffset: number,
    self: number,
    lift: (payloadPtr: number) => T,
    ...args: (number | bigint)[]
  ): T {
    const ret = this.#call(name, self, ...args);
    try {
      if (this.#dv().getUint8(ret) === 1) {
        throw new Error(this.#string(ret + payloadOffset));
      }
      return lift(ret + payloadOffset);
    } finally {
      this.#postReturn(name, ret);
    }
  }
}
