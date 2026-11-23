// SPDX-License-Identifier: MPL-2.0

import {
  AudioChunk,
  decodePcm,
  G726Format,
  isG726,
  isPcm,
  splitFrames,
  WEBCODECS_CODECS,
} from "./decode";
import { decodeG726, G726Bits, G726Decoder } from "./g726";
import { LATENCY_SEC, MAX_DRIFT_SEC, planChunk } from "./schedule";

const FADE_SEC = 0.01;

/**
 * Plays audio chunks on the Web Audio clock. Each "session" (audio between two cuts) has its own
 * gain node, so a seek or jump fades out everything queued without touching what comes next.
 */
export class AudioPlayer {
  public readonly analyser: AnalyserNode;
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
  /** Bumped by cut() so decodes that finish afterwards are dropped. */
  #epoch = 0;
  /** Partial MP3/AAC frame left over from the previous message, and when it should play. */
  #pending = new Uint8Array(0);
  #pendingStart = 0;
  /** G.726 predictor state carries over between messages until a cut or a format change. */
  #g726: { format: G726Format; decoder: G726Decoder } | undefined;

  public constructor() {
    this.#ctx = new AudioContext({ latencyHint: "playback" });
    this.analyser = this.#ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.#output = this.#ctx.createGain();
    // Analyse before the volume so the waveform stays visible while muted
    this.analyser.connect(this.#output).connect(this.#ctx.destination);
    this.#session = this.#newSession();
  }

  public isRunning(): boolean {
    return this.#ctx.state === "running";
  }

  /** Calls `listener` when the audio clock starts or stops. Returns the unsubscribe function. */
  public subscribeRunning(listener: () => void): () => void {
    this.#ctx.addEventListener("statechange", listener);
    return () => {
      this.#ctx.removeEventListener("statechange", listener);
    };
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
    this.#epoch++;
    this.#fadeOut();
    this.#closeDecoder();
    this.#fallbackQueue = Promise.resolve();
    this.#pending = new Uint8Array(0);
    this.#g726 = undefined;
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
    if (speed !== this.#speed) {
      // Queued and still-decoding audio has the old rate baked in: re-sync at the new speed
      this.#speed = speed;
      this.cut();
    }
    if (!this.isRunning()) {
      return;
    }
    const idealStart = this.#ctx.currentTime + LATENCY_SEC - delaySec / speed;
    const { format } = chunk;
    if (isPcm(format)) {
      this.#play(decodePcm(chunk.data, format, chunk.channels), chunk.sampleRate, idealStart);
      return;
    }
    if (isG726(format)) {
      // "g726-32" → 32 kbit/s at 8 kHz → 4 bits per codeword
      const bits = (Number(format.slice(-2)) / 8) as G726Bits;
      if (this.#g726?.format !== format) {
        this.#g726 = { format, decoder: new G726Decoder(bits) };
      }
      const packing = format.startsWith("aal2-") ? "aal2" : "rfc3551";
      this.#play([decodeG726(chunk.data, this.#g726.decoder, bits, packing)], 8000, idealStart);
      return;
    }
    const codec = WEBCODECS_CODECS[format];
    if (codec != undefined && typeof AudioDecoder !== "undefined") {
      this.#decode(codec, chunk, idealStart);
      return;
    }
    // Containers (wav, flac, ...) or no WebCodecs: each message must be a decodable file
    const bytes = chunk.data.slice().buffer;
    const epoch = this.#epoch;
    this.#fallbackQueue = this.#fallbackQueue
      .then(async () => {
        if (epoch !== this.#epoch) {
          return;
        }
        const buffer = await this.#ctx.decodeAudioData(bytes);
        if (epoch !== this.#epoch) {
          return;
        }
        const planes = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
          buffer.getChannelData(ch),
        );
        this.#play(planes, buffer.sampleRate, idealStart);
      })
      .catch(() => this.onError?.(`This browser can't decode "${format}" audio.`));
  }

  public close(): void {
    this.#closeDecoder();
    void this.#ctx.close().catch(() => {});
  }

  /** A decoder that hit an error is already closed, and closing it again throws. */
  #closeDecoder(): void {
    if (this.#decoder != undefined && this.#decoder.state !== "closed") {
      this.#decoder.close();
    }
    this.#decoder = undefined;
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
      this.#closeDecoder();
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
        if (decoder.state !== "closed") {
          decoder.close();
        }
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
