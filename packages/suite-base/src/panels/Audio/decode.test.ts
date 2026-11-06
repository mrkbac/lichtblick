// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { decodePcm, extractAudioChunk, normalizeFormat, splitFrames } from "./decode";

const overrides = { format: "auto" as const, sampleRate: 16000, channels: 1 };

describe("normalizeFormat", () => {
  it.each([
    ["pcm-s16", "s16"],
    ["S16LE", "s16"],
    ["pcm_f32le", "f32"],
    ["PCMU", "mulaw"],
    ["audio/mpeg", "mp3"],
    ["opus", "opus"],
    ["wave", "wav"],
  ])("maps %s to %s", (raw, expected) => {
    expect(normalizeFormat(raw)).toBe(expected);
  });

  it("returns undefined for unknown formats", () => {
    expect(normalizeFormat("pcm-s24")).toBeUndefined();
  });
});

describe("extractAudioChunk", () => {
  it("reads foxglove.RawAudio fields", () => {
    const data = new Uint8Array([1, 2]);
    expect(
      extractAudioChunk(
        { data, format: "pcm-s16", sample_rate: 48000, number_of_channels: 2 },
        overrides,
      ),
    ).toEqual({ format: "s16", sampleRate: 48000, channels: 2, data });
  });

  it("reads nested audio_common_msgs/AudioDataStamped data and uses the fallback settings", () => {
    expect(extractAudioChunk({ audio: { data: [1, 2] } }, { ...overrides, format: "mp3" })).toEqual(
      { format: "mp3", sampleRate: 16000, channels: 1, data: new Uint8Array([1, 2]) },
    );
  });

  it("lets the setting override the message's format", () => {
    expect(
      extractAudioChunk(
        { data: new Uint8Array(), format: "pcm-s16" },
        { ...overrides, format: "f32" },
      ),
    ).toMatchObject({ format: "f32" });
  });

  it("reports missing data, missing format and unsupported formats", () => {
    expect(extractAudioChunk({ format: "pcm-s16" }, overrides)).toHaveProperty("error");
    expect(extractAudioChunk({ data: new Uint8Array() }, overrides)).toEqual({
      error: expect.stringContaining("no `format`"),
    });
    expect(extractAudioChunk({ data: new Uint8Array(), format: "dts" }, overrides)).toEqual({
      error: 'Unsupported audio format "dts".',
    });
  });
});

describe("decodePcm", () => {
  it("de-interleaves s16 little endian", () => {
    const bytes = new Uint8Array(new Int16Array([0, -32768, 16384, 32767]).buffer);
    const [left, right] = decodePcm(bytes, "s16", 2);
    expect(Array.from(left!)).toEqual([0, 0.5]);
    expect(Array.from(right!)).toEqual([-1, 32767 / 32768]);
  });

  it("decodes f32 and u8", () => {
    const f32 = new Uint8Array(new Float32Array([0.25, -0.5]).buffer);
    expect(Array.from(decodePcm(f32, "f32", 1)[0]!)).toEqual([0.25, -0.5]);
    expect(Array.from(decodePcm(new Uint8Array([0, 128, 192]), "u8", 1)[0]!)).toEqual([-1, 0, 0.5]);
  });

  it("respects the byte offset of a subarray", () => {
    const bytes = new Uint8Array([9, 0, 0x40]).subarray(1);
    expect(Array.from(decodePcm(bytes, "s16", 1)[0]!)).toEqual([0.5]);
  });

  it("decodes G.711 mu-law and A-law", () => {
    // 0xff / 0xd5 are silence, 0x80 / 0xaa are the loudest positive samples
    expect(Array.from(decodePcm(new Uint8Array([0xff, 0x80]), "mulaw", 1)[0]!)).toEqual([
      0,
      32124 / 32768,
    ]);
    expect(Array.from(decodePcm(new Uint8Array([0xd5, 0xaa]), "alaw", 1)[0]!)).toEqual([
      8 / 32768,
      32256 / 32768,
    ]);
  });

  it("drops a trailing partial frame", () => {
    expect(decodePcm(new Uint8Array(5), "s16", 2)[0]).toHaveLength(1);
  });
});

describe("splitFrames", () => {
  // MPEG-1 layer III, 64 kbps, 44.1 kHz, no padding: 208 bytes, 1152 samples
  function mp3Frame(): Uint8Array {
    const frame = new Uint8Array(208);
    frame.set([0xff, 0xfb, 0x50, 0xc4]);
    return frame;
  }

  // ADTS AAC-LC, 44.1 kHz, one raw block
  function adtsFrame(length: number): Uint8Array {
    const frame = new Uint8Array(length);
    frame.set([
      0xff,
      0xf1,
      0x50,
      0x80 | (length >> 11),
      (length >> 3) & 0xff,
      ((length & 7) << 5) | 0x1f,
      0xfc,
    ]);
    return frame;
  }

  function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  it("splits MP3 frames and keeps a partial frame for the next message", () => {
    const stream = concat(new Uint8Array([0x49, 0x44, 0x33]), mp3Frame(), mp3Frame(), mp3Frame());
    const first = splitFrames(stream.subarray(0, 3 + 208 + 100), "mp3");
    expect(first.frames).toHaveLength(1);
    expect(first.frames[0]!.data).toHaveLength(208);
    expect(first.frames[0]!.duration).toBeCloseTo(1152 / 44100);
    expect(first.rest).toHaveLength(100);

    const second = splitFrames(concat(first.rest, stream.subarray(3 + 208 + 100)), "mp3");
    expect(second.frames).toHaveLength(2);
    expect(second.rest).toHaveLength(0);
  });

  it("splits ADTS frames", () => {
    const { frames, rest } = splitFrames(concat(adtsFrame(100), adtsFrame(300)), "aac");
    expect(frames.map((frame) => frame.data.length)).toEqual([100, 300]);
    expect(frames[0]!.duration).toBeCloseTo(1024 / 44100);
    expect(rest).toHaveLength(0);
  });
});
