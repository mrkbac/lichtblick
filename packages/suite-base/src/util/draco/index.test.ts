// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";

import { decodeDracoPointCloud, dracoMessageConverters, loadDraco } from "./index";

// A synthetic 100-point helix (see point()) with RGBA colors, encoded by DracoPy 1.x with the
// default 14-bit position quantization.
const PAYLOAD = Uint8Array.from(
  atob(
    [
      "RFJBQ08CAwAAAABkAAAAAQIACQMAAAICBAABAgEAAQEADytdPwekA/BPvgHA/w8ARIHMIJgHlUVQGRmDIEYEFsGxhAuCq9EV",
      "BN/DqAi26EoQNFOHIJgp7kTQWJiBoLqcEkGECQSCHqMFBFkmhgjKLAIQfPkPIljySEBQ4uGAIL5dEkFr5wWCrP4NBPkcoAga",
      "+UcQTLCdIohcU0FQsNGC4E3pFcF1QgyCmxxZBJPoMggYUGYQyGLLIpBKkEEgnwyDQFHdFYHHLgsC1P1UBCrcJghAmUYQMPR9",
      "IlDr2UCg222JQL9DAoGLUwMCKB9EBGQuAwjI7AMRWBkcIMCxYECgYA+JgLm2AoFfkQYCkjpPBLx0IgiQCEwRKA+lIAAaYUEA",
      "K+eKAEMMBoFedCwCbVgZBDYwMwjaIGYRPATKIHgNi0GQJPyKIFy2BcHbzCqC+SEUBG/UJAjCSUIRDJV0IMisxUQQXkKBIMPq",
      "AcGQmSKCLqsCBGU2AAi6vAkRFPknIOhwd0Rw3juB4LMJA8FSLyeCc2YQBHmMpAj+908Q5K2rIFjXa0VwpfqCYDcnBkFHliyC",
      "PIQZBCooswiYcWUQuGXHIFDQg0VAqumCAAAAAAD/PwAAAAEBAQEFKRApENkPA9kPZjI1Pg0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N",
      "DQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N",
      "DQ0NDXXjugAAAAD/AAAAbfOfwNv8n8AAAAAAtvkfQQ4=",
    ].join(""),
  ),
  (c) => c.charCodeAt(0),
);
const POINTS = 100;

function point(i: number) {
  return {
    x: Math.cos(i * 0.1) * 5,
    y: Math.sin(i * 0.1) * 5,
    z: i * 0.01,
    color: [i % 256, (2 * i) % 256, 255 - i, 255],
  };
}

describe("draco", () => {
  beforeAll(async () => {
    await loadDraco();
  });

  it("decodes positions and colors into packed fields", () => {
    const { fields, point_stride, data } = decodeDracoPointCloud(PAYLOAD);
    expect(fields).toEqual([
      { name: "x", offset: 0, type: 7 },
      { name: "y", offset: 4, type: 7 },
      { name: "z", offset: 8, type: 7 },
      { name: "red", offset: 12, type: 1 },
      { name: "green", offset: 13, type: 1 },
      { name: "blue", offset: 14, type: 1 },
      { name: "alpha", offset: 15, type: 1 },
    ]);
    expect(point_stride).toBe(16);
    expect(data.byteLength).toBe(POINTS * 16);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < POINTS; i++) {
      const expected = point(i);
      const o = i * point_stride;
      expect(view.getFloat32(o, true)).toBeCloseTo(expected.x, 2);
      expect(view.getFloat32(o + 4, true)).toBeCloseTo(expected.y, 2);
      expect(view.getFloat32(o + 8, true)).toBeCloseTo(expected.z, 2);
      expect([...data.subarray(o + 12, o + 16)]).toEqual(expected.color);
    }
  });

  it("rejects corrupt data", () => {
    expect(() => decodeDracoPointCloud(PAYLOAD.subarray(0, 20))).toThrow();
  });

  it("converts a foxglove.CompressedPointCloud message to a foxglove.PointCloud once", () => {
    const converter = dracoMessageConverters.find(
      (c) => c.fromSchemaName === "foxglove.CompressedPointCloud",
    )!;
    expect(converter.toSchemaName).toBe("foxglove.PointCloud");
    const pose = { position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
    const msg = {
      timestamp: { sec: 1, nsec: 2 },
      frame_id: "lidar",
      pose,
      data: PAYLOAD,
      format: "draco",
    };
    const event = { topic: "/points" } as MessageEvent;
    const emitAlert = vi.fn();
    const result = converter.converter(msg, event, undefined, { emitAlert });
    expect(result).toMatchObject({
      timestamp: msg.timestamp,
      frame_id: "lidar",
      pose,
      point_stride: 16,
    });
    expect(converter.converter(msg, event, undefined, { emitAlert })).toBe(result);
    expect(emitAlert).not.toHaveBeenCalled();
  });

  it("warns about unsupported formats", () => {
    const emitAlert = vi.fn();
    const result = dracoMessageConverters[0]!.converter(
      { data: PAYLOAD, format: "lzf" },
      { topic: "/points" } as MessageEvent,
      undefined,
      { emitAlert },
    );
    expect(result).toBeUndefined();
    expect(emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "warn" }),
      "draco-format-lzf",
    );
  });
});
