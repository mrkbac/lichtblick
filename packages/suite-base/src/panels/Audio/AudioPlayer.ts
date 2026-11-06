// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AudioChunk, decodePcm, isPcm, splitFrames, WEBCODECS_CODECS } from "./decode";
import { LATENCY_SEC, MAX_DRIFT_SEC, planChunk } from "./schedule";

const FADE_SEC = 0.01;

/**
 * Plays audio chunks on the Web Audio clock. Each "session" (audio between two cuts) has its own
 * gain node, so a seek or jump fades out everything queued without touching what comes next.
 */
export class AudioPlayer {
  public readonly analyser: AnalyserNode;
  /** Called when the context starts or stops running, e.g. after a user gesture. */
  public onStateChange?: () => void;
  public onError?: (message: string) => void;

  readonly #ctx: AudioContext;
  readonly #output: GainNode;
  #session: GainNode;
  #sessionStarted = false;
  #sources = new Set<AudioBufferSourceNode>();
  #nextStart: number | undefined;
  #speed = 1;
  #decoder: AudioDecoder | undefined;
  #decoderKey = "";
  #fallbackQueue = Promise.resolve();
  /** Partial MP3/AAC frame left over from the previous message, and when it should play. */
  #pending = new Uint8Array(0);
  #pendingStart = 0;

  public constructor() {
    this.#ctx = new AudioContext({ latencyHint: "playback" });
    this.analyser = this.#ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.#output = this.#ctx.createGain();
    // Analyse before the volume so the waveform stays visible while muted
    this.analyser.connect(this.#output).connect(this.#ctx.destination);
    this.#session = this.#newSession();
    this.#ctx.onstatechange = () => this.onStateChange?.();
  }

  public isRunning(): boolean {
    return this.#ctx.state === "running";
  }

  public setVolume(volume: number): void {
    this.#output.gain.setTargetAtTime(volume, this.#ctx.currentTime, FADE_SEC);
  }

  /** Resumes the audio clock. Browsers allow this only after a user gesture on the page. */
  public resume(): void {
    void this.#ctx.resume().catch(() => {});
  }

  /** Pauses the audio clock, keeping what is queued. */
  public suspend(): void {
    void this.#ctx.suspend().catch(() => {});
  }

  /** Fades out and drops everything queued or still decoding, e.g. on seek. */
  public cut(): void {
    this.#fadeOut();
    this.#decoder?.close();
    this.#decoder = undefined;
    this.#fallbackQueue = Promise.resolve();
    this.#pending = new Uint8Array(0);
  }

  #fadeOut(): void {
    const now = this.#ctx.currentTime;
    const gain = this.#session.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + FADE_SEC);
    for (const source of this.#sources) {
      source.stop(now + FADE_SEC);
    }
    this.#sources.clear();
    this.#session = this.#newSession();
    this.#nextStart = undefined;
  }

  /**
   * Queues a chunk. `delaySec` is how far (in playback time) the playhead already is past the
   * start of the chunk; `speed` is the playback speed.
   */
  public push(chunk: AudioChunk, delaySec: number, speed: number): void {
    this.#speed = speed;
    if (!this.isRunning()) {
      return;
    }
    const idealStart = this.#ctx.currentTime + LATENCY_SEC - delaySec / speed;
    const { format } = chunk;
    if (isPcm(format)) {
      this.#play(decodePcm(chunk.data, format, chunk.channels), chunk.sampleRate, idealStart);
      return;
    }
    const codec = WEBCODECS_CODECS[format];
    if (codec != undefined && typeof AudioDecoder !== "undefined") {
      this.#decode(codec, chunk, idealStart);
      return;
    }
    // Containers (wav, flac, ...) or no WebCodecs: each message must be a decodable file
    const bytes = chunk.data.slice().buffer;
    this.#fallbackQueue = this.#fallbackQueue
      .then(async () => {
        const buffer = await this.#ctx.decodeAudioData(bytes);
        const planes = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
          buffer.getChannelData(ch),
        );
        this.#play(planes, buffer.sampleRate, idealStart);
      })
      .catch(() => this.onError?.(`This browser can't decode "${format}" audio.`));
  }

  public close(): void {
    this.#decoder?.close();
    void this.#ctx.close().catch(() => {});
  }

  #newSession(): GainNode {
    const gain = this.#ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.analyser);
    this.#sessionStarted = false;
    return gain;
  }

  #decode(codec: string, chunk: AudioChunk, idealStart: number): void {
    const key = `${codec}/${chunk.sampleRate}/${chunk.channels}`;
    if (this.#decoder?.state !== "configured" || key !== this.#decoderKey) {
      this.#decoder?.close();
      const decoder = new AudioDecoder({
        output: (data) => {
          const planes = Array.from({ length: data.numberOfChannels }, (_, ch) => {
            const plane = new Float32Array(data.numberOfFrames);
            data.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
            return plane;
          });
          this.#play(planes, data.sampleRate, data.timestamp / 1e6);
          data.close();
        },
        error: (err) => this.onError?.(`Can't decode "${chunk.format}" audio: ${err.message}`),
      });
      try {
        decoder.configure({
          codec,
          sampleRate: chunk.sampleRate,
          numberOfChannels: chunk.channels,
        });
      } catch (err) {
        this.onError?.(`Can't decode "${chunk.format}" audio: ${String(err)}`);
        return;
      }
      this.#decoder = decoder;
      this.#decoderKey = key;
    }
    const decoder = this.#decoder;
    // The input timestamp carries each frame's ideal start time through the decoder
    const decode = (data: Uint8Array, start: number) => {
      decoder.decode(
        new EncodedAudioChunk({ type: "key", timestamp: Math.round(start * 1e6), data }),
      );
    };
    if (chunk.format !== "mp3" && chunk.format !== "aac") {
      decode(chunk.data, idealStart);
      return;
    }

    // MP3 and ADTS decoders take one frame per chunk, but messages may split frames anywhere
    const bytes = new Uint8Array(this.#pending.length + chunk.data.length);
    bytes.set(this.#pending);
    bytes.set(chunk.data, this.#pending.length);
    let start =
      this.#pending.length > 0 && Math.abs(this.#pendingStart - idealStart) <= MAX_DRIFT_SEC
        ? this.#pendingStart
        : idealStart;
    const { frames, rest } = splitFrames(bytes, chunk.format);
    for (const frame of frames) {
      decode(frame.data, start);
      start += frame.duration / this.#speed;
    }
    // Garbage that never forms a frame must not grow forever
    this.#pending = rest.length < 65536 ? rest.slice() : new Uint8Array(0);
    this.#pendingStart = start;
  }

  #play(planes: Float32Array<ArrayBuffer>[], sampleRate: number, idealStart: number): void {
    const frames = planes[0]?.length ?? 0;
    if (frames === 0 || !this.isRunning()) {
      return;
    }
    const speed = this.#speed;
    const duration = frames / sampleRate / speed;
    const now = this.#ctx.currentTime;
    const plan = planChunk({ now, nextStart: this.#nextStart, idealStart, duration });
    if (plan.kind === "drop") {
      return;
    }
    if (plan.cut) {
      this.#fadeOut();
    }

    let buffer: AudioBuffer;
    try {
      buffer = this.#ctx.createBuffer(planes.length, frames, sampleRate);
    } catch {
      this.onError?.(`Unsupported sample rate ${sampleRate} Hz.`);
      return;
    }
    planes.forEach((plane, ch) => {
      buffer.copyToChannel(plane, ch);
    });

    const source = this.#ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    source.connect(this.#session);
    source.start(plan.start, plan.skip * speed);
    source.onended = () => this.#sources.delete(source);
    this.#sources.add(source);
    this.#nextStart = plan.start + duration - plan.skip;

    if (!this.#sessionStarted) {
      // Fade in after a cut so restarting mid-waveform doesn't click
      this.#session.gain.setValueAtTime(0, plan.start);
      this.#session.gain.linearRampToValueAtTime(1, plan.start + FADE_SEC);
      this.#sessionStarted = true;
    }
  }
}
