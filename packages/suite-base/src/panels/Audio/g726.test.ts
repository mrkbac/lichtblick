// SPDX-License-Identifier: MPL-2.0

import { decodeG726, G726Bits, G726Decoder, G726Packing } from "./g726";

/** Encodes by trying every codeword on a copy of the decoder and keeping the closest one. */
function encode(signal: Float32Array, bits: G726Bits): number[] {
  const decoder = new G726Decoder(bits);
  return Array.from(signal, (sample) => {
    let best = 0;
    let bestError = Infinity;
    for (let code = 0; code < 1 << bits; code++) {
      const error = Math.abs(decoder.clone().decode(code) - sample);
      if (error < bestError) {
        best = code;
        bestError = error;
      }
    }
    decoder.decode(best);
    return best;
  });
}

/** Packs codewords least significant bit first (RFC 3551), or most significant first (AAL2). */
function pack(codes: number[], bits: number, packing: G726Packing): Uint8Array {
  const aal2 = packing === "aal2";
  const bytes: number[] = [];
  let buffer = 0;
  let residue = 0;
  for (const code of codes) {
    buffer = aal2 ? (buffer << bits) | code : buffer | (code << residue);
    residue += bits;
    while (residue >= 8) {
      residue -= 8;
      bytes.push(aal2 ? (buffer >> residue) & 0xff : buffer & 0xff);
      if (!aal2) {
        buffer >>= 8;
      }
    }
  }
  return Uint8Array.from(bytes);
}

function snrDb(signal: Float32Array, decoded: Float32Array): number {
  let power = 0;
  let noise = 0;
  signal.forEach((sample, i) => {
    power += sample ** 2;
    noise += (sample - decoded[i]!) ** 2;
  });
  return 10 * Math.log10(power / noise);
}

// 0.2 s of a 440 Hz tone at 8 kHz
const SIGNAL = Float32Array.from(
  { length: 1600 },
  (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 8000),
);

describe("G.726", () => {
  it.each([
    [2, 5],
    [3, 12],
    [4, 18],
    [5, 24],
  ] as const)("decodes %i-bit codewords with an SNR above %i dB", (bits, minSnr) => {
    const codes = encode(SIGNAL, bits);
    for (const packing of ["rfc3551", "aal2"] as const) {
      const decoder = new G726Decoder(bits);
      // Split into messages of whole codeword groups: state carries over between them
      const bytes = pack(codes, bits, packing);
      const group = bits === 3 ? 3 : bits === 5 ? 5 : 1;
      const split = Math.floor(bytes.length / 2 / group) * group;
      const decoded = Float32Array.from([
        ...decodeG726(bytes.subarray(0, split), decoder, bits, packing),
        ...decodeG726(bytes.subarray(split), decoder, bits, packing),
      ]);
      expect(decoded.length).toBe(SIGNAL.length);
      // Skip the first samples while the step size adapts
      expect(snrDb(SIGNAL.subarray(200), decoded.subarray(200))).toBeGreaterThan(minSnr);
    }
  });

  it("outputs silence for a stream of zero-difference codewords", () => {
    const decoder = new G726Decoder(4);
    const decoded = decodeG726(new Uint8Array(100), decoder, 4, "rfc3551");
    expect(Math.max(...decoded.map(Math.abs))).toBeLessThan(0.01);
  });
});
