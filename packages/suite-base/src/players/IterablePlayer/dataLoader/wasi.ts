// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Minimal `wasi_snapshot_preview1` for data loaders built for wasm32-wasip1 (Foxglove's C++ SDK
// and Rust loaders that pick that target). Loaders read files only through the loader's reader
// interface, so there is no filesystem: stdout and stderr go to the log, clocks and randomness
// work, and every other call fails with ENOSYS.

const SUCCESS = 0;
const EBADF = 8;
const ENOSYS = 52;
const FILETYPE_CHARACTER_DEVICE = 2;

type Log = { info(msg: string): void; error(msg: string): void };
type WasiFn = (...args: (number | bigint)[]) => number;

export function wasiImports(memory: () => ArrayBuffer, log: Log): Record<string, WasiFn> {
  const view = () => new DataView(memory());
  const decoder = new TextDecoder();
  const writeZeros = (...ptrs: number[]) => {
    for (const ptr of ptrs) {
      view().setUint32(ptr, 0, true);
    }
    return SUCCESS;
  };

  const fns: Record<string, WasiFn> = {
    fd_write: (fd, iovs, iovsLen, nwrittenPtr) => {
      if (fd !== 1 && fd !== 2) {
        return EBADF;
      }
      const dv = view();
      let text = "";
      let written = 0;
      for (let i = 0; i < Number(iovsLen); i++) {
        const ptr = dv.getUint32(Number(iovs) + i * 8, true);
        const len = dv.getUint32(Number(iovs) + i * 8 + 4, true);
        text += decoder.decode(new Uint8Array(memory(), ptr, len));
        written += len;
      }
      if (text.trim() !== "") {
        if (fd === 1) {
          log.info(text.trimEnd());
        } else {
          log.error(text.trimEnd());
        }
      }
      dv.setUint32(Number(nwrittenPtr), written, true);
      return SUCCESS;
    },
    fd_fdstat_get: (fd, ptr) => {
      if (Number(fd) > 2) {
        return EBADF;
      }
      new Uint8Array(memory(), Number(ptr), 24).fill(0);
      view().setUint8(Number(ptr), FILETYPE_CHARACTER_DEVICE);
      return SUCCESS;
    },
    // No preopened directories: wasi-libc stops looking for them at the first EBADF
    fd_prestat_get: () => EBADF,
    environ_sizes_get: (countPtr, sizePtr) => writeZeros(Number(countPtr), Number(sizePtr)),
    environ_get: () => SUCCESS,
    args_sizes_get: (countPtr, sizePtr) => writeZeros(Number(countPtr), Number(sizePtr)),
    args_get: () => SUCCESS,
    clock_time_get: (id, _precision, timePtr) => {
      // 0 is the realtime clock; the others count from an arbitrary start
      const ms = id === 0 ? Date.now() : performance.now();
      view().setBigUint64(Number(timePtr), BigInt(Math.round(ms * 1e6)), true);
      return SUCCESS;
    },
    random_get: (ptr, len) => {
      // getRandomValues fills at most 64 KiB per call
      for (let off = 0; off < Number(len); off += 65536) {
        const chunk = new Uint8Array(Math.min(65536, Number(len) - off));
        crypto.getRandomValues(chunk);
        new Uint8Array(memory(), Number(ptr) + off, chunk.byteLength).set(chunk);
      }
      return SUCCESS;
    },
    proc_exit: (code) => {
      throw new Error(`Data loader exited with code ${code}`);
    },
  };
  return new Proxy(fns, { get: (target, name: string) => target[name] ?? (() => ENOSYS) });
}
