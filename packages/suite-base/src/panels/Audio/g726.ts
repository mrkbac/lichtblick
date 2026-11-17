// SPDX-License-Identifier: MPL-2.0

// G.726 ADPCM decoder (ITU-T G.726, 16/24/32/40 kbit/s, 8 kHz mono), written from the
// recommendation's block diagrams. Integer arithmetic follows the spec's fixed-point formats;
// values the spec keeps in 16 bits wrap like int16.

export type G726Bits = 2 | 3 | 4 | 5;

type Tables = {
  /** Reconstructed log magnitude of the difference signal, per codeword (DQLN) */
  dqln: readonly number[];
  /** Scale factor multiplier, per codeword (W, already scaled by 32) */
  wi: readonly number[];
  /** Transition detector input, per codeword (F) */
  fi: readonly number[];
};

// Tables 7 to 10 of G.726, indexed by codeword (the sign bit is the codeword's top bit).
const TABLES: Record<G726Bits, Tables> = {
  2: {
    dqln: [116, 365, 365, 116],
    wi: [-704, 14048, 14048, -704],
    fi: [0x000, 0xe00, 0xe00, 0x000],
  },
  3: {
    dqln: [-2048, 135, 273, 373, 373, 273, 135, -2048],
    wi: [-128, 960, 4384, 18624, 18624, 4384, 960, -128],
    fi: [0x000, 0x200, 0x400, 0xe00, 0xe00, 0x400, 0x200, 0x000],
  },
  4: {
    dqln: [-2048, 4, 135, 213, 273, 323, 373, 425, 425, 373, 323, 273, 213, 135, 4, -2048],
    wi: [
      -384, 576, 1312, 2048, 3584, 6336, 11360, 35904, 35904, 11360, 6336, 3584, 2048, 1312, 576,
      -384,
    ],
    fi: [
      0x000, 0x000, 0x000, 0x200, 0x200, 0x200, 0x600, 0xe00, 0xe00, 0x600, 0x200, 0x200, 0x200,
      0x000, 0x000, 0x000,
    ],
  },
  5: {
    dqln: [
      -2048, -66, 28, 104, 169, 224, 274, 318, 358, 395, 429, 459, 488, 514, 539, 566, 566, 539,
      514, 488, 459, 429, 395, 358, 318, 274, 224, 169, 104, 28, -66, -2048,
    ],
    wi: [
      448, 448, 768, 1248, 1280, 1312, 1856, 3200, 4512, 5728, 7008, 8960, 11456, 14080, 16928,
      22272, 22272, 16928, 14080, 11456, 8960, 7008, 5728, 4512, 3200, 1856, 1312, 1280, 1248, 768,
      448, 448,
    ],
    fi: [
      0x000, 0x000, 0x000, 0x000, 0x000, 0x200, 0x200, 0x200, 0x200, 0x200, 0x400, 0x600, 0x800,
      0xa00, 0xc00, 0xc00, 0xc00, 0xc00, 0xa00, 0x800, 0x600, 0x400, 0x200, 0x200, 0x200, 0x200,
      0x200, 0x000, 0x000, 0x000, 0x000, 0x000,
    ],
  },
};

const i16 = (value: number) => (value << 16) >> 16;

/** Index of the highest set bit, -1 for zero. */
const topBit = (value: number) => 31 - Math.clz32(value);

/** A value in the spec's 4-bit exponent, 6-bit mantissa float format (FLOAT A / FLOAT B). */
function toFloat(value: number): number {
  if (value === 0) {
    return 0x20;
  }
  const mag = Math.abs(value);
  const exp = topBit(mag) + 1;
  const float = (exp << 6) + ((mag << 6) >> exp);
  return value > 0 ? float : i16(float - 0x400);
}

/** Multiplies a predictor coefficient by a value in float format (FMULT). */
function fmult(an: number, srn: number): number {
  const anmag = an > 0 ? an : -an & 0x1fff;
  const anexp = topBit(anmag) - 5;
  const anmant = anmag === 0 ? 32 : anexp >= 0 ? anmag >> anexp : anmag << -anexp;
  const wanexp = anexp + ((srn >> 6) & 0xf) - 13;
  const wanmant = (anmant * (srn & 0x3f) + 0x30) >> 4;
  const product = wanexp >= 0 ? (wanmant << wanexp) & 0x7fff : wanmant >> -wanexp;
  return (an ^ srn) < 0 ? -product : product;
}

type State = {
  /** Quantizer scale factors: unlocked (fast) and locked (slow) */
  yu: number;
  yl: number;
  /** Adaptation speed, and the short and long term averages it is derived from */
  ap: number;
  dms: number;
  dml: number;
  /** Pole and zero predictor coefficients */
  a: number[];
  b: number[];
  /** Signs of the last two pole prediction differences */
  pk: number[];
  /** The last reconstructed signal and difference values, in float format */
  sr: number[];
  dq: number[];
  /** Tone detected */
  td: boolean;
};

/** Decoder state for one continuous G.726 stream. */
export class G726Decoder {
  readonly #bits: G726Bits;
  readonly #tables: Tables;
  #s: State = {
    yu: 544,
    yl: 34816,
    ap: 0,
    dms: 0,
    dml: 0,
    a: [0, 0],
    b: [0, 0, 0, 0, 0, 0],
    pk: [0, 0],
    sr: [32, 32],
    dq: [32, 32, 32, 32, 32, 32],
    td: false,
  };

  public constructor(bits: G726Bits) {
    this.#bits = bits;
    this.#tables = TABLES[bits];
  }

  /** A decoder in the same state, e.g. to try codewords without changing this one. */
  public clone(): G726Decoder {
    const copy = new G726Decoder(this.#bits);
    copy.#s = structuredClone(this.#s);
    return copy;
  }

  /** Decodes one codeword into a 14-bit linear sample, scaled to [-1, 1). */
  public decode(code: number): number {
    const { dqln, wi, fi } = this.#tables;
    const signBit = 1 << (this.#bits - 1);
    let sezi = 0;
    for (let i = 0; i < 6; i++) {
      sezi += fmult(this.#s.b[i]! >> 2, this.#s.dq[i]!);
    }
    sezi = i16(sezi);
    const sei = i16(
      sezi + fmult(this.#s.a[1]! >> 2, this.#s.sr[1]!) + fmult(this.#s.a[0]! >> 2, this.#s.sr[0]!),
    );
    const se = sei >> 1;
    const y = this.#stepSize();

    // Reconstruct the quantized difference signal (ADDA, ANTILOG)
    let dq: number;
    const dql = i16(dqln[code]! + (y >> 2));
    if (dql < 0) {
      dq = (code & signBit) !== 0 ? -0x8000 : 0;
    } else {
      const dex = (dql >> 7) & 15;
      const dqt = 128 + (dql & 127);
      const mag = (dqt << 7) >> (14 - dex);
      dq = i16((code & signBit) !== 0 ? mag - 0x8000 : mag);
    }

    const sr = i16(dq < 0 ? se - (dq & 0x3fff) : se + dq);
    const dqsez = i16(sr + (sezi >> 1) - se);
    this.#update(y, wi[code]!, fi[code]!, dq, sr, dqsez);
    return (sr << 2) / 32768;
  }

  /** Quantizer scale factor (MIX) */
  #stepSize(): number {
    if (this.#s.ap >= 256) {
      return this.#s.yu;
    }
    let y = this.#s.yl >> 6;
    const dif = this.#s.yu - y;
    const al = this.#s.ap >> 2;
    if (dif > 0) {
      y += (dif * al) >> 6;
    } else if (dif < 0) {
      y += (dif * al + 0x3f) >> 6;
    }
    return y;
  }

  #update(y: number, wi: number, fi: number, dq: number, sr: number, dqsez: number): void {
    const pk0 = dqsez < 0 ? 1 : 0;
    const mag = dq & 0x7fff;

    // Transition detector (TRANS)
    const ylint = this.#s.yl >> 15;
    const ylfrac = (this.#s.yl >> 10) & 0x1f;
    const thr = ylint > 9 ? 31 << 10 : (32 + ylfrac) << ylint;
    const dqthr = (thr + (thr >> 1)) >> 1;
    const tr = this.#s.td && mag > dqthr;

    // Quantizer scale factor adaptation (FUNCTW, FILTD, LIMB, FILTE)
    this.#s.yu = Math.min(Math.max(y + ((wi - y) >> 5), 544), 5120);
    this.#s.yl += this.#s.yu + (-this.#s.yl >> 6);

    // Adaptive predictor coefficients
    let a2p = 0;
    if (tr) {
      this.#s.a.fill(0);
      this.#s.b.fill(0);
    } else {
      const pks1 = pk0 ^ this.#s.pk[0]!;
      // UPA2, LIMC
      a2p = i16(this.#s.a[1]! - (this.#s.a[1]! >> 7));
      if (dqsez !== 0) {
        const fa1 = pks1 !== 0 ? this.#s.a[0]! : -this.#s.a[0]!;
        if (fa1 < -8191) {
          a2p -= 0x100;
        } else if (fa1 > 8191) {
          a2p += 0xff;
        } else {
          a2p += fa1 >> 5;
        }
        if ((pk0 ^ this.#s.pk[1]!) !== 0) {
          a2p = a2p <= -12160 ? -12288 : a2p >= 12416 ? 12288 : a2p - 0x80;
        } else {
          a2p = a2p <= -12416 ? -12288 : a2p >= 12160 ? 12288 : a2p + 0x80;
        }
      }
      this.#s.a[1] = a2p;
      // UPA1, LIMD
      let a1 = this.#s.a[0]! - (this.#s.a[0]! >> 8);
      if (dqsez !== 0) {
        a1 += pks1 === 0 ? 192 : -192;
      }
      const a1ul = 15360 - a2p;
      this.#s.a[0] = Math.min(Math.max(a1, -a1ul), a1ul);
      // UPB: the 40 kbit/s coder leaks more slowly
      const leak = this.#bits === 5 ? 9 : 8;
      for (let i = 0; i < 6; i++) {
        let b = this.#s.b[i]! - (this.#s.b[i]! >> leak);
        if (mag !== 0) {
          b += (dq ^ this.#s.dq[i]!) >= 0 ? 128 : -128;
        }
        this.#s.b[i] = i16(b);
      }
    }

    // Delay lines, in float format (FLOAT A, FLOAT B)
    this.#s.dq.pop();
    this.#s.dq.unshift(mag === 0 ? (dq >= 0 ? 0x20 : i16(0xfc20)) : toFloat(dq >= 0 ? mag : -mag));
    this.#s.sr[1] = this.#s.sr[0]!;
    this.#s.sr[0] = sr <= -32768 ? i16(0xfc20) : toFloat(sr);
    this.#s.pk[1] = this.#s.pk[0]!;
    this.#s.pk[0] = pk0;

    // Tone detector (TONE)
    this.#s.td = !tr && a2p < -11776;

    // Adaptation speed control (FILTA, FILTB, SUBTC)
    this.#s.dms += (fi - this.#s.dms) >> 5;
    this.#s.dml += ((fi << 2) - this.#s.dml) >> 7;
    if (tr) {
      this.#s.ap = 256;
    } else if (
      y < 1536 ||
      this.#s.td ||
      Math.abs((this.#s.dms << 2) - this.#s.dml) >= this.#s.dml >> 3
    ) {
      this.#s.ap += (0x200 - this.#s.ap) >> 4;
    } else {
      this.#s.ap += -this.#s.ap >> 4;
    }
  }
}

/**
 * How codewords are packed into bytes: "rfc3551" starts at the least significant bit, "aal2" at
 * the most significant bit.
 */
export type G726Packing = "rfc3551" | "aal2";

/**
 * Decodes one message of packed codewords. Codewords never span messages, but the decoder state
 * carries over.
 */
export function decodeG726(
  data: Uint8Array,
  decoder: G726Decoder,
  bits: G726Bits,
  packing: G726Packing,
): Float32Array<ArrayBuffer> {
  const aal2 = packing === "aal2";
  const samples = new Float32Array(Math.floor((data.length * 8) / bits));
  const mask = (1 << bits) - 1;
  let buffer = 0;
  let residue = 0;
  let n = 0;
  for (const byte of data) {
    if (aal2) {
      buffer = ((buffer << 8) | byte) & 0xffff;
      residue += 8;
      while (residue >= bits) {
        residue -= bits;
        samples[n++] = decoder.decode((buffer >> residue) & mask);
      }
    } else {
      buffer |= byte << residue;
      residue += 8;
      while (residue >= bits) {
        samples[n++] = decoder.decode(buffer & mask);
        buffer >>= bits;
        residue -= bits;
      }
    }
  }
  return samples;
}
