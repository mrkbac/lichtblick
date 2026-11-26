// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import fs from "node:fs";
import path from "node:path";

import { SyncFile, WasmDataLoader, uniqueFilePaths } from "./WasmDataLoader";
import { WasmDataLoaderIterableSource } from "./WasmDataLoaderIterableSource";

// Loaders built from fixtures/text_loader with Foxglove's published foxglove_data_loader crate.
// Each input line is `<log_time_ns> <topic> <json>`.
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name));
const FIXTURES = {
  "crate 0.2.1, wasm32-unknown-unknown": fixture("text_loader.wasm"),
  "crate 0.1.0, wasm32-wasip1": fixture("text_loader_v0.1_wasip1.wasm"),
};
const wasm = FIXTURES["crate 0.2.1, wasm32-unknown-unknown"];

function memFile(text: string): SyncFile {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.byteLength,
    readInto: (out, offset) => {
      const chunk = bytes.subarray(offset, offset + out.byteLength);
      out.set(chunk);
      return chunk.byteLength;
    },
  };
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

async function load(files: Record<string, string>, module: Uint8Array = wasm) {
  return await WasmDataLoader.create(
    module,
    new Map(Object.entries(files).map(([name, text]) => [name, memFile(text)])),
    log,
  );
}

const decode = (data: Uint8Array) => new TextDecoder().decode(data);

/**
 * The core-module import and export names that the canonical ABI gives Foxglove's WIT world
 * (loader.wit, vendored unchanged): imported interfaces become import modules, the exported
 * interface becomes `<interface>#<function>` exports plus resource intrinsics.
 */
function abiNamesFromWit(wit: string) {
  const pkg = /^package ([\w:-]+)@([\d.]+);/m.exec(wit)!;
  const interfaces = new Map<string, { funcs: string[]; resources: Map<string, string[]> }>();
  for (const [, name, body] of wit.matchAll(/^interface ([\w-]+) \{([\s\S]*?)^\}/gm)) {
    const resources = new Map<string, string[]>();
    for (const [, res, resBody] of body!.matchAll(/resource ([\w-]+) \{([\s\S]*?)\n {4}\}/g)) {
      resources.set(
        res!,
        [...resBody!.matchAll(/^\s*(constructor|[\w-]+: func)\(/gm)].map(([, f]) =>
          f === "constructor" ? `[constructor]${res}` : `[method]${res}.${f!.split(":")[0]}`,
        ),
      );
    }
    const withoutResources = body!.replace(/resource [\w-]+ \{[\s\S]*?\n {4}\}/g, "");
    const funcs = [...withoutResources.matchAll(/^\s*([\w-]+): func\(/gm)].map(([, f]) => f!);
    interfaces.set(name!, { funcs, resources });
  }
  const world = /^world [\w-]+ \{([\s\S]*?)^\}/m.exec(wit)![1]!;
  const qualified = (iface: string) => `${pkg[1]}/${iface}@${pkg[2]}`;
  const imports: Record<string, string[]> = {};
  const exports: string[] = [];
  for (const [, kind, iface] of world.matchAll(/^\s*(import|export) ([\w-]+);/gm)) {
    const { funcs, resources } = interfaces.get(iface!)!;
    if (kind === "import") {
      imports[qualified(iface!)] = [
        ...funcs,
        ...[...resources].flatMap(([res, fns]) => [...fns, `[resource-drop]${res}`]),
      ].sort();
    } else {
      exports.push(
        ...[...funcs, ...[...resources].flatMap(([res, fns]) => [...fns, `[dtor]${res}`])].map(
          (f) => `${qualified(iface!)}#${f}`,
        ),
      );
      imports[`[export]${qualified(iface!)}`] = [...resources.keys()]
        .flatMap((res) => [`[resource-new]${res}`, `[resource-rep]${res}`, `[resource-drop]${res}`])
        .sort();
    }
  }
  return { imports, exports: exports.sort() };
}

describe("foxglove:loader contract", () => {
  const abi = abiNamesFromWit(fs.readFileSync(path.join(__dirname, "loader.wit"), "utf8"));

  it("derives the expected names from Foxglove's WIT", () => {
    expect(Object.keys(abi.imports).sort()).toEqual([
      "[export]foxglove:loader/loader@0.1.0",
      "foxglove:loader/console@0.1.0",
      "foxglove:loader/reader@0.1.0",
    ]);
    expect(abi.imports["foxglove:loader/reader@0.1.0"]).toContain("[method]reader.read");
    expect(abi.exports).toContain("foxglove:loader/loader@0.1.0#[method]message-iterator.next");
  });

  it("provides exactly the imports the WIT world defines", async () => {
    const instantiate = vi.spyOn(WebAssembly, "instantiate");
    await load({});
    const imports = instantiate.mock.calls[0]![1] as Record<string, Record<string, unknown>>;
    instantiate.mockRestore();
    for (const [module, names] of Object.entries(abi.imports)) {
      expect(Object.keys(imports[module]!).sort()).toEqual(names);
    }
  });

  it.each(Object.entries(FIXTURES))("matches what Foxglove's crate generates (%s)", (_, bytes) => {
    const module = new WebAssembly.Module(bytes);
    const loaderExports = WebAssembly.Module.exports(module)
      .map(({ name }) => name)
      .filter((name) => name.startsWith("foxglove:"));
    expect(loaderExports.sort()).toEqual(abi.exports);
    const outsideWit = WebAssembly.Module.imports(module).filter(
      ({ module: mod, name }) =>
        mod !== "wasi_snapshot_preview1" && abi.imports[mod]?.includes(name) !== true,
    );
    expect(outsideWit).toEqual([]);
  });
});

describe.each(Object.entries(FIXTURES))("WasmDataLoader (%s)", (target, module) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes, iterates and backfills", async () => {
    const loader = await load(
      {
        "a.txt": '30 /b {"v":3}\n10 /a {"v":1}\nbroken\n',
        "b.txt": '20 /a {"v":2}\n',
      },
      module,
    );

    const init = loader.initialize();
    expect(log.info).toHaveBeenCalledWith("loaded 3 rows");
    // stdout only exists through WASI
    expect(log.info.mock.calls.some(([msg]) => msg === "stdout: 3 rows")).toBe(
      target.includes("wasip1"),
    );
    expect(init.startTime).toBe(10n);
    expect(init.endTime).toBe(30n);
    expect(init.schemas).toEqual([
      { id: 1, name: "test.Value", encoding: "jsonschema", data: expect.any(Uint8Array) },
    ]);
    expect(decode(init.schemas[0]!.data)).toBe('{"type":"object"}');
    expect(init.channels).toEqual([
      { id: 1, schemaId: 1, topicName: "/b", messageEncoding: "json", messageCount: 1n },
      { id: 2, schemaId: 1, topicName: "/a", messageEncoding: "json", messageCount: 2n },
    ]);
    expect(init.problems).toEqual([
      { severity: "warn", message: "a.txt:3: malformed line", tip: undefined },
    ]);

    const all = [...loader.messages({ channels: [1, 2] })];
    expect(all.map((m) => [m.channelId, m.logTime, decode(m.data)])).toEqual([
      [2, 10n, '{"v":1}'],
      [2, 20n, '{"v":2}'],
      [1, 30n, '{"v":3}'],
    ]);
    expect(all[0]!.publishTime).toBe(10n);

    const inRange = [...loader.messages({ channels: [2], start: 15n, end: 30n })];
    expect(inRange.map((m) => m.logTime)).toEqual([20n]);

    expect(loader.backfill(25n, [1, 2]).map((m) => [m.channelId, m.logTime])).toEqual([[2, 20n]]);
  });

  it("surfaces loader errors", async () => {
    const loader = await load({ "a.txt": "notanumber /a {}\n" }, module);
    expect(() => loader.initialize()).toThrow("invalid digit");
  });
});

describe("uniqueFilePaths", () => {
  it("keeps every file when names repeat", () => {
    expect(uniqueFilePaths(["a.txt", "b.txt", "a.txt", "a.txt"])).toEqual([
      "a.txt",
      "b.txt",
      "2/a.txt",
      "3/a.txt",
    ]);
  });
});

describe("WasmDataLoader imports", () => {
  it("rejects modules that import outside the loader world and WASI", async () => {
    // (module (import "env" "f" (func)))
    const bytes = Uint8Array.from([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 9, 1, 3, 101, 110, 118, 1, 102, 0, 0,
    ]);
    await expect(WasmDataLoader.create(bytes, new Map(), log)).rejects.toThrow("env.f");
  });
});

describe("WasmDataLoaderIterableSource", () => {
  it("plays a loader's channels as serialized topics", async () => {
    const source = new WasmDataLoaderIterableSource(
      wasm,
      new Map([["a.txt", memFile('1000000000 /a {"v":1}\n2000000000 /a {"v":2}\n')]]),
    );

    const init = await source.initialize();
    expect(init.start).toEqual({ sec: 1, nsec: 0 });
    expect(init.end).toEqual({ sec: 2, nsec: 0 });
    expect(init.topics).toEqual([
      {
        name: "/a",
        schemaName: "test.Value",
        messageEncoding: "json",
        schemaEncoding: "jsonschema",
        schemaData: expect.any(Uint8Array),
      },
    ]);
    expect(init.topicStats.get("/a")).toEqual({ numMessages: 2 });
    expect(init.datatypes.has("test.Value")).toBe(true);

    const events = [];
    for await (const result of source.messageIterator({
      topics: new Map([["/a", { topic: "/a" }]]),
      start: { sec: 1, nsec: 500_000_000 },
    })) {
      events.push(result);
    }
    expect(events).toEqual([
      {
        type: "message-event",
        msgEvent: expect.objectContaining({
          topic: "/a",
          receiveTime: { sec: 2, nsec: 0 },
          schemaName: "test.Value",
          sizeInBytes: 7,
        }),
      },
    ]);

    const backfill = await source.getBackfillMessages({
      topics: new Map([["/a", { topic: "/a" }]]),
      time: { sec: 1, nsec: 500_000_000 },
    });
    expect(backfill.map((m) => m.receiveTime)).toEqual([{ sec: 1, nsec: 0 }]);
  });
});
