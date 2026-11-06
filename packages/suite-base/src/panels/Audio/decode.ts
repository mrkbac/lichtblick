// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** PCM sample formats decoded in JS, without the browser's decoders. */
export type PcmFormat = "s16" | "s16be" | "s32" | "f32" | "u8" | "mulaw" | "alaw";
/** Compressed formats handed to WebCodecs `AudioDecoder` or `decodeAudioData`. */
export type CompressedFormat = "opus" | "mp3" | "aac" | "vorbis" | "flac" | "wav";
export type AudioFormat = PcmFormat | CompressedFormat;

export const AUDIO_FORMATS: readonly AudioFormat[] = [
  "s16",
  "s16be",
  "s32",
  "f32",
  "u8",
  "mulaw",
  "alaw",
  "opus",
  "mp3",
  "aac",
  "vorbis",
  "flac",
  "wav",
];

/** Schemas whose topics the panel offers and auto-selects. */
export const AUDIO_SCHEMAS: ReadonlySet<string> = new Set([
  "foxglove.RawAudio",
  "foxglove_msgs/RawAudio",
  "foxglove_msgs/msg/RawAudio",
  "audio_common_msgs/AudioData",
  "audio_common_msgs/msg/AudioData",
  "audio_common_msgs/AudioDataStamped",
  "audio_common_msgs/msg/AudioDataStamped",
]);

const ALIASES: Record<string, AudioFormat> = {
  s16le: "s16",
  int16: "s16",
  s16be: "s16be",
  s32le: "s32",
  int32: "s32",
  f32le: "f32",
  float32: "f32",
  float: "f32",
  u8: "u8",
  uint8: "u8",
  ulaw: "mulaw",
  "mu-law": "mulaw",
  pcmu: "mulaw",
  pcma: "alaw",
  "a-law": "alaw",
  mpeg: "mp3",
  ogg: "vorbis",
  wave: "wav",
};

/** Maps format strings like "pcm-s16", "S16LE", "audio/mpeg" or "PCMU" to a format, if known. */
export function normalizeFormat(raw: string): AudioFormat | undefined {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^audio\//, "")
    .replace(/^pcm[-_]/, "");
  if ((AUDIO_FORMATS as readonly string[]).includes(name)) {
    return name as AudioFormat;
  }
  return ALIASES[name];
}

export function isPcm(format: AudioFormat): format is PcmFormat {
  return !["opus", "mp3", "aac", "vorbis", "flac", "wav"].includes(format);
}

export const MIN_SAMPLE_RATE = 3000;
export const MAX_SAMPLE_RATE = 768000;
export const MAX_CHANNELS = 32;

export type AudioChunk = {
  format: AudioFormat;
  /** Sample rate in Hz, from the message or the panel's fallback. */
  sampleRate: number;
  channels: number;
  data: Uint8Array;
};

export type ChunkOverrides = {
  /** "auto" uses the message's `format` field. */
  format: AudioFormat | "auto";
  sampleRate: number;
  channels: number;
};

function toBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value as number[]);
  }
  return undefined;
}

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Reads one audio chunk from a message: `data`, `format`, `sample_rate` and `number_of_channels`
 * (foxglove.RawAudio), or `audio.data` (audio_common_msgs/AudioDataStamped). Fields missing in
 * the message come from the panel settings.
 */
export function extractAudioChunk(
  message: unknown,
  overrides: ChunkOverrides,
): AudioChunk | { error: string } {
  const msg = (message ?? {}) as Record<string, unknown>;
  const audio = (msg.audio ?? {}) as Record<string, unknown>;
  const data = toBytes(msg.data ?? audio.data);
  if (data == undefined) {
    return { error: "Message has no audio `data` field." };
  }

  let format: AudioFormat | undefined;
  if (overrides.format !== "auto") {
    format = overrides.format;
  } else if (typeof msg.format === "string" && msg.format !== "") {
    format = normalizeFormat(msg.format);
    if (format == undefined) {
      return { error: `Unsupported audio format "${msg.format}".` };
    }
  } else {
    return { error: "Message has no `format` field. Choose a format in the panel settings." };
  }

  const sampleRate = positiveInt(msg.sample_rate) ?? overrides.sampleRate;
  const channels = positiveInt(msg.number_of_channels) ?? overrides.channels;
  // Web Audio's limits; also keeps a corrupt header from allocating billions of channels
  if (!(sampleRate >= MIN_SAMPLE_RATE && sampleRate <= MAX_SAMPLE_RATE)) {
    return { error: `Unsupported sample rate ${sampleRate} Hz.` };
  }
  if (!(Number.isInteger(channels) && channels >= 1 && channels <= MAX_CHANNELS)) {
    return { error: `Unsupported channel count ${channels}.` };
  }
  return { format, sampleRate, channels, data };
}

const BYTES_PER_SAMPLE: Record<PcmFormat, number> = {
  s16: 2,
  s16be: 2,
  s32: 4,
  f32: 4,
  u8: 1,
  mulaw: 1,
  alaw: 1,
};

// G.711 expansion, see ITU-T G.711.
function mulawToFloat(byte: number): number {
  const u = ~byte & 0xff;
  const t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  return ((u & 0x80) !== 0 ? 0x84 - t : t - 0x84) / 32768;
}

function alawToFloat(byte: number): number {
  const a = byte ^ 0x55;
  const exponent = (a & 0x70) >> 4;
  let t = (a & 0x0f) << 4;
  t = exponent === 0 ? t + 8 : (t + 0x108) << (exponent - 1);
  return ((a & 0x80) !== 0 ? t : -t) / 32768;
}

/** Decodes interleaved PCM bytes into one Float32Array per channel, in [-1, 1]. */
export function decodePcm(
  data: Uint8Array,
  format: PcmFormat,
  channels: number,
): Float32Array<ArrayBuffer>[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frameBytes = BYTES_PER_SAMPLE[format] * channels;
  const frames = Math.floor(data.byteLength / frameBytes);
  const planes = Array.from({ length: channels }, () => new Float32Array(frames));
  const read: (offset: number) => number = {
    s16: (o: number) => view.getInt16(o, true) / 32768,
    s16be: (o: number) => view.getInt16(o, false) / 32768,
    s32: (o: number) => view.getInt32(o, true) / 2147483648,
    f32: (o: number) => view.getFloat32(o, true),
    u8: (o: number) => (view.getUint8(o) - 128) / 128,
    mulaw: (o: number) => mulawToFloat(view.getUint8(o)),
    alaw: (o: number) => alawToFloat(view.getUint8(o)),
  }[format];
  const step = BYTES_PER_SAMPLE[format];
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      planes[ch]![i] = read(i * frameBytes + ch * step);
    }
  }
  return planes;
}

/** WebCodecs codec strings; formats not listed here go through `decodeAudioData`. */
export const WEBCODECS_CODECS: Partial<Record<CompressedFormat, string>> = {
  opus: "opus",
  mp3: "mp3",
  aac: "mp4a.40.2",
};

/** Formats whose WebCodecs decoder needs exactly one frame per chunk. */
export type FramedFormat = "mp3" | "aac";

export type EncodedFrame = { data: Uint8Array; duration: number };

const MP3_BITRATES_KBPS = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_SAMPLE_RATES = [44100, 48000, 32000];
const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

/** Length in bytes and duration in seconds of the MP3 (layer III) or ADTS frame at `i`. */
function frameAt(
  bytes: Uint8Array,
  i: number,
  format: FramedFormat,
): { length: number; duration: number } | undefined {
  const [b0, b1, b2, b3, b4, b5, b6] = bytes.subarray(i, i + 7);
  if (b0 !== 0xff || b1 == undefined || b2 == undefined) {
    return undefined;
  }
  if (format === "aac") {
    if ((b1 & 0xf6) !== 0xf0 || b3 == undefined || b4 == undefined || b5 == undefined) {
      return undefined;
    }
    const sampleRate = AAC_SAMPLE_RATES[(b2 >> 2) & 0x0f];
    const length = ((b3 & 0x03) << 11) | (b4 << 3) | (b5 >> 5);
    const blocks = ((b6 ?? 0) & 0x03) + 1;
    return sampleRate != undefined && length > 7
      ? { length, duration: (1024 * blocks) / sampleRate }
      : undefined;
  }
  const version = (b1 >> 3) & 0x03; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
  const layer = (b1 >> 1) & 0x03; // 1: layer III
  if ((b1 & 0xe0) !== 0xe0 || version === 1 || layer !== 1) {
    return undefined;
  }
  const mpeg1 = version === 3;
  const kbps = (mpeg1 ? MP3_BITRATES_KBPS.v1 : MP3_BITRATES_KBPS.v2)[b2 >> 4];
  const baseRate = MP3_SAMPLE_RATES[(b2 >> 2) & 0x03];
  if (kbps == undefined || kbps === 0 || baseRate == undefined) {
    return undefined;
  }
  const sampleRate = baseRate / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  const samples = mpeg1 ? 1152 : 576;
  const padding = (b2 >> 1) & 0x01;
  return {
    length: Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding,
    duration: samples / sampleRate,
  };
}

/**
 * Splits an MP3 or ADTS AAC byte stream into frames. Messages needn't be frame-aligned: `rest`
 * holds a trailing partial frame to prepend to the next message's bytes. Bytes that aren't a
 * frame (ID3 tags, corruption) are skipped.
 */
export function splitFrames(
  bytes: Uint8Array,
  format: FramedFormat,
): { frames: EncodedFrame[]; rest: Uint8Array } {
  const frames: EncodedFrame[] = [];
  let i = 0;
  while (i + 7 <= bytes.length) {
    const frame = frameAt(bytes, i, format);
    if (!frame) {
      i++;
      continue;
    }
    if (i + frame.length > bytes.length) {
      break;
    }
    frames.push({ data: bytes.subarray(i, i + frame.length), duration: frame.duration });
    i += frame.length;
  }
  return { frames, rest: bytes.subarray(i) };
}
