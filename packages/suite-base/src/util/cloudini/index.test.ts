// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";

import { cloudiniMessageConverter, decodeCloudini, loadCloudini } from "./index";

// A synthetic 200-point helix (see cloud()) encoded by upstream Cloudini 1.4.1 at 1 mm resolution
// (wire format V06): x, y, z, intensity float32 at 0..12, ring uint16 at 16, 2 padding bytes.
const PAYLOAD = Uint8Array.from(
  atob(
    [
      "Q0xPVURJTklfVjA2CnZlcnNpb246IDYKd2lkdGg6IDIwMApoZWlnaHQ6IDEKcG9pbnRfc3RlcDogMjAKZW5jb2Rpbmdfb3B0",
      "OiBMT1NTWQpjb21wcmVzc2lvbl9vcHQ6IFpTVEQKZmllbGRzOgogIC0gbmFtZTogeAogICAgb2Zmc2V0OiAwCiAgICB0eXBl",
      "OiBGTE9BVDMyCiAgICByZXNvbHV0aW9uOiAwLjAwMQogIC0gbmFtZTogeQogICAgb2Zmc2V0OiA0CiAgICB0eXBlOiBGTE9B",
      "VDMyCiAgICByZXNvbHV0aW9uOiAwLjAwMQogIC0gbmFtZTogegogICAgb2Zmc2V0OiA4CiAgICB0eXBlOiBGTE9BVDMyCiAg",
      "ICByZXNvbHV0aW9uOiAwLjAxMDAwMDAwMQogIC0gbmFtZTogaW50ZW5zaXR5CiAgICBvZmZzZXQ6IDEyCiAgICB0eXBlOiBG",
      "TE9BVDMyCiAgICByZXNvbHV0aW9uOiAwLjAwMQogIC0gbmFtZTogcmluZwogICAgb2Zmc2V0OiAxNgogICAgdHlwZTogVUlO",
      "VDE2CiAgICByZXNvbHV0aW9uOiBudWxsCgDzAQAAKLUv/WCJApwAAFgBAz8B//v/ygHKAQIAYGIBaAFQBgCRTjJkYGJaWFRK",
      "SDw4LCYYEggFDRkfLTE/QUtTVVtfY2NnY2NjXV1TUUtBOzEpIRUNAQb7DvAHMDg+Rk5UWlpiYGZiZGJeXFZSTEQ+Mi4iGBAG",
      "BREZIy0zPUdLUVddYWFlY2dhY11bU1FHQTkxKRsXCQEKFCAkNDZCSE5UWlxiYmRkYmJeWlhOTEI8NCogGA4EBxMZJys3P0dL",
      "U1ldYWFlZWVjX19ZU09HPzktJx0TBwEOFCImNDhESFBWWGBgYmRkZGBeWlRQSkA8UAYAAecHChIgJjA4QEhQUlpcYmJiZmJg",
      "YlhYTk5COjYqIhYQBAcRGyMvNT1HTVFZXV9lYWdltwSOAVlTT0k/NzElHRUHAQwWICY0OEJKTlRcXGJiZGRkXmBaVk5KQjww",
      "LB4WDAQJEx0jMTc/R01VV19fZWNlZWNfX1dTTUc/Ny0lGxEJBAwaHiwyOkRKUFZcXGJiZmJkYFxaVk5IQDowKCASDAINESEl",
      "MTdDR09VWV9hY2NnY2NfXVdTS0c7Ny0hGw8HBg4YJCwyPkRMUHwAADABAwEFAgECAA9ADSIwBJwAAEABAX1/0A99fwMArZoU",
      "ADJJdkSNAABYAxoAAAABAQMPHgcBAG86JA==",
    ].join(""),
  ),
  (c) => c.charCodeAt(0),
);
const POINTS = 200;
const STEP = 20;

function cloud(i: number) {
  const nan = i === 50;
  return {
    x: nan ? NaN : Math.fround(Math.cos(i * 0.1) * 5),
    y: nan ? NaN : Math.fround(Math.sin(i * 0.1) * 5),
    z: nan ? NaN : Math.fround(i * 0.01),
    intensity: Math.fround((i % 17) / 16),
    ring: i % 16,
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    header: { stamp: { sec: 1, nsec: 2 }, frame_id: "lidar" },
    height: 1,
    width: POINTS,
    fields: [],
    is_bigendian: false,
    point_step: STEP,
    row_step: POINTS * STEP,
    compressed_data: PAYLOAD,
    is_dense: false,
    format: "cloudini",
    ...overrides,
  };
}

function convert(msg: ReturnType<typeof message>, emitAlert = vi.fn()) {
  return cloudiniMessageConverter.converter(msg, { topic: "/points" } as MessageEvent, undefined, {
    emitAlert,
  }) as { data: Uint8Array; row_step: number; header: unknown } | undefined;
}

describe("cloudini", () => {
  beforeAll(async () => {
    await loadCloudini();
  });

  it("decodes within half the resolution, integers and NaN exactly, padding zeroed", () => {
    const data = decodeCloudini(PAYLOAD, POINTS * STEP);
    const view = new DataView(data.buffer, data.byteOffset);
    const read = (i: number) => ({
      x: view.getFloat32(i * STEP, true),
      y: view.getFloat32(i * STEP + 4, true),
      z: view.getFloat32(i * STEP + 8, true),
      intensity: view.getFloat32(i * STEP + 12, true),
      ring: view.getUint16(i * STEP + 16, true),
      padding: view.getUint16(i * STEP + 18, true),
    });
    let maxXyzError = 0;
    let maxIntensityError = 0;
    for (let i = 0; i < POINTS; i++) {
      const expected = cloud(i);
      const actual = read(i);
      for (const k of ["x", "y", "z"] as const) {
        // A NaN error (a wrong NaN) propagates through Math.max and fails the check below
        const error = Number.isNaN(expected[k]) ? 0 : Math.abs(actual[k] - expected[k]);
        maxXyzError = Math.max(maxXyzError, error);
      }
      maxIntensityError = Math.max(
        maxIntensityError,
        Math.abs(actual.intensity - expected.intensity),
      );
      expect([actual.ring, actual.padding]).toEqual([expected.ring, 0]);
    }
    expect(maxXyzError).toBeLessThanOrEqual(0.0005 + 1e-6);
    expect(maxIntensityError).toBeLessThan(0.001);
    expect(read(50)).toMatchObject({ x: NaN, y: NaN, z: NaN });
  });

  it("rejects a payload whose size does not match the message", () => {
    expect(() => decodeCloudini(PAYLOAD, POINTS * STEP - 1)).toThrow(/does not match/);
    expect(() => decodeCloudini(new Uint8Array([1, 2, 3]), 16)).toThrow();
    // 2^32 + 4000 would wrap to the real size 4000 in WASM's 32-bit arguments
    expect(() => decodeCloudini(PAYLOAD, 2 ** 32 + POINTS * STEP)).toThrow(/Invalid decoded size/);
    expect(() => decodeCloudini(PAYLOAD, -1)).toThrow(/Invalid decoded size/);
  });

  it("converts to PointCloud2 once per message", () => {
    const msg = message();
    const converted = convert(msg);
    expect(converted?.data.byteLength).toBe(POINTS * STEP);
    expect(converted?.row_step).toBe(POINTS * STEP);
    expect(converted?.header).toBe(msg.header);
    expect(converted).not.toHaveProperty("compressed_data");
    expect(convert(msg)).toBe(converted);
  });

  it("reports corrupt payloads instead of throwing", () => {
    const emitAlert = vi.fn();
    expect(convert(message({ compressed_data: new Uint8Array([1, 2, 3]) }), emitAlert)).toBe(
      undefined,
    );
    expect(emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "error", error: expect.any(Error) }),
      "cloudini-decode-/points",
    );
  });

  it("warns about other compression formats", () => {
    const emitAlert = vi.fn();
    expect(convert(message({ format: "draco" }), emitAlert)).toBeUndefined();
    expect(emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "warn" }),
      "cloudini-format-draco",
    );
  });

  it("stops waiting for a stalled download when aborted", async () => {
    vi.resetModules();
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(() => {}));
    const fresh = await import("./index");
    const topics = [{ schemaName: fresh.CLOUDINI_SCHEMA }];
    const abort = new AbortController();
    const waiting = fresh.preloadCloudini(topics, abort.signal);
    abort.abort();
    await expect(waiting).resolves.toBeUndefined();
    // aborted before the call, e.g. the player closed while its source initialized
    await expect(fresh.preloadCloudini(topics, abort.signal)).resolves.toBeUndefined();
  }, 1000);
});
