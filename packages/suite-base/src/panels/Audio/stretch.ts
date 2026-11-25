// SPDX-License-Identifier: MPL-2.0

const FRAME_SEC = 0.03;
/** How far a frame may move from its ideal position to line up with the previous one. */
const SEEK_SEC = 0.01;
/** Correlate every n-th sample: alignment barely changes and it is n times cheaper. */
const CORRELATION_STEP = 4;

/**
 * Changes the speed of audio without changing its pitch (WSOLA: overlap-add of windowed input
 * frames, each shifted a little so its waveform continues the previous one).
 *
 * Streaming: input may arrive in chunks of any size and the output is the same as for one big
 * chunk, so there are no clicks at message boundaries. Output lags the input by about one frame.
 */
export class TimeStretcher {
  readonly #speed: number;
  readonly #frame: number;
  readonly #hop: number;
  readonly #seek: number;
  readonly #hann: Float32Array;
  /** Input not consumed yet, per channel; `#inputStart` is the absolute index of its first frame. */
  #input: Float32Array[];
  #inputStart = 0;
  /** Input frames pushed so far. */
  public inputFrames = 0;
  /** Overlap-add accumulator, one frame long per channel. */
  readonly #acc: Float32Array[];
  /**
   * Most input (in frames) held back before it comes out: a frame, the search range, and at slow
   * speeds the hop the next frame reads ahead. Schedule output this much (/ speed) later.
   */
  public readonly latency: number;
  /** Index of the next output frame. */
  #k = 0;
  /** Input position of the previous output frame. */
  #prev: number | undefined;

  public constructor(channels: number, sampleRate: number, speed: number) {
    this.#speed = speed;
    this.#hop = Math.round((sampleRate * FRAME_SEC) / 2);
    this.#frame = this.#hop * 2;
    this.#seek = Math.round(sampleRate * SEEK_SEC);
    this.latency = this.#frame + this.#hop + this.#seek;
    // Periodic Hann at 50 % overlap sums to exactly 1
    this.#hann = Float32Array.from(
      { length: this.#frame },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.#frame),
    );
    this.#input = Array.from({ length: channels }, () => new Float32Array(0));
    this.#acc = Array.from({ length: channels }, () => new Float32Array(this.#frame));
  }

  /**
   * Adds input and returns the output that is ready, plus the input position (in input frames
   * since the start) the first output frame corresponds to.
   */
  public push(planes: readonly Float32Array[]): {
    planes: Float32Array<ArrayBuffer>[];
    inputPos: number;
  } {
    this.#input = this.#input.map((old, ch) => {
      const plane = planes[ch] ?? planes[0]!;
      const merged = new Float32Array(old.length + plane.length);
      merged.set(old);
      merged.set(plane, old.length);
      return merged;
    });
    this.inputFrames += planes[0]?.length ?? 0;
    const inputEnd = this.#inputStart + this.#input[0]!.length;
    const firstK = this.#k;
    const blocks: Float32Array[][] = [];

    for (;;) {
      const ideal = Math.round(this.#k * this.#hop * this.#speed);
      const natural = this.#prev == undefined ? undefined : this.#prev + this.#hop;
      const lo = natural == undefined ? ideal : Math.max(ideal - this.#seek, this.#inputStart);
      const hi = natural == undefined ? ideal : ideal + this.#seek;
      if (Math.max(hi, natural ?? 0) + this.#frame > inputEnd) {
        break;
      }
      const pos = natural == undefined ? ideal : this.#bestMatch(lo, hi, natural);
      blocks.push(this.#overlapAdd(pos));
      this.#prev = pos;
      this.#k++;
    }

    // Keep only what the next frame may still read
    const nextIdeal = Math.round(this.#k * this.#hop * this.#speed) - this.#seek;
    const keepFrom = Math.min(nextIdeal, (this.#prev ?? 0) + this.#hop);
    const drop = Math.max(0, Math.min(keepFrom - this.#inputStart, this.#input[0]!.length));
    if (drop > 0) {
      this.#input = this.#input.map((plane) => plane.slice(drop));
      this.#inputStart += drop;
    }

    return {
      planes: this.#acc.map((_, ch) => {
        const out = new Float32Array(blocks.length * this.#hop);
        blocks.forEach((block, i) => {
          out.set(block[ch]!, i * this.#hop);
        });
        return out;
      }),
      inputPos: firstK * this.#hop * this.#speed,
    };
  }

  /** The input position in [lo, hi] whose frame best continues the waveform at `natural`. */
  #bestMatch(lo: number, hi: number, natural: number): number {
    const x = this.#input[0]!;
    const target = natural - this.#inputStart;
    let best = lo;
    let bestScore = -Infinity;
    for (let pos = lo; pos <= hi; pos++) {
      const offset = pos - this.#inputStart;
      let score = 0;
      for (let i = 0; i < this.#frame; i += CORRELATION_STEP) {
        score += x[offset + i]! * x[target + i]!;
      }
      if (score > bestScore) {
        bestScore = score;
        best = pos;
      }
    }
    return best;
  }

  /** Adds the windowed frame at `pos` and returns the `hop` samples that are now complete. */
  #overlapAdd(pos: number): Float32Array[] {
    const offset = pos - this.#inputStart;
    return this.#acc.map((acc, ch) => {
      const x = this.#input[ch]!;
      for (let i = 0; i < this.#frame; i++) {
        acc[i]! += this.#hann[i]! * x[offset + i]!;
      }
      const done = acc.slice(0, this.#hop);
      acc.copyWithin(0, this.#hop);
      acc.fill(0, this.#frame - this.#hop);
      return done;
    });
  }
}
