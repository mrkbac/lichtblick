// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  decodeBGR8,
  decodeBGRA8,
  decodeBayerBGGR8,
  decodeBayerGBRG8,
  decodeBayerGRBG8,
  decodeBayerRGGB8,
  decodeFloat1c,
  decodeMono16,
  decodeMono8,
  decodeYUV420,
  decodeRGB8,
  decodeRGBA8,
  decodeUYVY,
  decodeYUYV,
} from "./decodings";

function float32LE(num: number) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setFloat32(0, num, true);
  return result;
}

function uint16LE(num: number) {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, num, true);
  return result;
}

describe("decodeBGR8", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = 3 * width + 2;
    const output = new Uint8ClampedArray(width * height * 4);
    decodeBGR8(
      new Uint8Array([
        ...[1, 2, 3, 11, 12, 13, 21, 22, 23, 31, 32, 33, 88, 99],
        ...[41, 42, 43, 51, 52, 53, 61, 62, 63, 71, 72, 73, 88, 99],
      ]),
      width,
      height,
      step,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray([
        ...[3, 2, 1, 255, 13, 12, 11, 255, 23, 22, 21, 255, 33, 32, 31, 255],
        ...[43, 42, 41, 255, 53, 52, 51, 255, 63, 62, 61, 255, 73, 72, 71, 255],
      ]),
    );
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = 3 * width - 1;
    expect(() => {
      decodeBGR8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: BGR8 image row step (11) must be at least 3*width (12)]`,
    );
    expect(() => {
      decodeBGR8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
    }).not.toThrow();
  });
});

describe("decodeBGRA8", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = 4 * width + 2;
    const output = new Uint8ClampedArray(width * height * 4);
    decodeBGRA8(
      new Uint8Array([
        ...[1, 2, 3, 4, 11, 12, 13, 14, 21, 22, 23, 24, 31, 32, 33, 34, 88, 99],
        ...[41, 42, 43, 44, 51, 52, 53, 54, 61, 62, 63, 64, 71, 72, 73, 74, 88, 99],
      ]),
      width,
      height,
      step,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray([
        ...[3, 2, 1, 4, 13, 12, 11, 14, 23, 22, 21, 24, 33, 32, 31, 34],
        ...[43, 42, 41, 44, 53, 52, 51, 54, 63, 62, 61, 64, 73, 72, 71, 74],
      ]),
    );
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = 4 * width - 1;
    expect(() => {
      decodeBGRA8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: BGRA8 image row step (15) must be at least 4*width (16)]`,
    );
    expect(() => {
      decodeBGRA8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
    }).not.toThrow();
  });
});

describe("decodeRGB8", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = 3 * width + 2;
    const output = new Uint8ClampedArray(width * height * 4);
    decodeRGB8(
      new Uint8Array([
        ...[1, 2, 3, 11, 12, 13, 21, 22, 23, 31, 32, 33, 88, 99],
        ...[41, 42, 43, 51, 52, 53, 61, 62, 63, 71, 72, 73, 88, 99],
      ]),
      width,
      height,
      step,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray([
        ...[1, 2, 3, 255, 11, 12, 13, 255, 21, 22, 23, 255, 31, 32, 33, 255],
        ...[41, 42, 43, 255, 51, 52, 53, 255, 61, 62, 63, 255, 71, 72, 73, 255],
      ]),
    );
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = 3 * width - 1;
    expect(() => {
      decodeRGB8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: RGB8 image row step (11) must be at least 3*width (12)]`,
    );
    expect(() => {
      decodeRGB8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
    }).not.toThrow();
  });
});

describe("decodeRGBA8", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = 4 * width + 2;
    const output = new Uint8ClampedArray(width * height * 4);
    decodeRGBA8(
      new Uint8Array([
        ...[1, 2, 3, 4, 11, 12, 13, 14, 21, 22, 23, 24, 31, 32, 33, 34, 88, 99],
        ...[41, 42, 43, 44, 51, 52, 53, 54, 61, 62, 63, 64, 71, 72, 73, 74, 88, 99],
      ]),
      width,
      height,
      step,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray([
        ...[1, 2, 3, 4, 11, 12, 13, 14, 21, 22, 23, 24, 31, 32, 33, 34],
        ...[41, 42, 43, 44, 51, 52, 53, 54, 61, 62, 63, 64, 71, 72, 73, 74],
      ]),
    );
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = 4 * width - 1;
    expect(() => {
      decodeRGBA8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: RGBA8 image row step (15) must be at least 4*width (16)]`,
    );
    expect(() => {
      decodeRGBA8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
    }).not.toThrow();
  });
});

describe("decodeYUV420", () => {
  // 4x2 image: one Y row per image row, one chroma sample per 2x2 block
  const Y = [
    [81, 145, 41, 210],
    [100, 120, 60, 200],
  ];
  const U = [90, 140];
  const V = [240, 100];

  // YUYV carries the same chroma per horizontal pixel pair, so it gives the expected output
  const expected = new Uint8ClampedArray(4 * 2 * 4);
  decodeYUYV(
    new Uint8Array(
      Y.flatMap((row) => [row[0]!, U[0]!, row[1]!, V[0]!, row[2]!, U[1]!, row[3]!, V[1]!]),
    ),
    4,
    2,
    8,
    expected,
  );

  it.each([
    ["i420", 4, [...Y[0]!, ...Y[1]!, ...U, ...V]],
    ["i420", 6, [...Y[0]!, 0, 0, ...Y[1]!, 0, 0, ...U, 0, ...V, 0]],
    ["nv12", 4, [...Y[0]!, ...Y[1]!, U[0]!, V[0]!, U[1]!, V[1]!]],
    ["nv12", 6, [...Y[0]!, 0, 0, ...Y[1]!, 0, 0, U[0]!, V[0]!, U[1]!, V[1]!, 0, 0]],
    ["nv21", 4, [...Y[0]!, ...Y[1]!, V[0]!, U[0]!, V[1]!, U[1]!]],
  ] as const)("decodes %s with step %d", (layout, step, data) => {
    const output = new Uint8ClampedArray(4 * 2 * 4);
    decodeYUV420(new Uint8Array(data), 4, 2, step, layout, output);
    expect(output).toEqual(expected);
  });

  it("decodes odd-width nv12 with an even row step", () => {
    // 3x2 NV12, step 4: Y rows padded by one byte, one chroma row with two UV pairs
    const data = new Uint8Array([...[1, 2, 3, 0], ...[4, 5, 6, 0], ...[128, 128, 128, 128]]);
    const output = new Uint8ClampedArray(3 * 2 * 4);
    decodeYUV420(data, 3, 2, 4, "nv12", output);
    expect(Array.from(output.filter((_, i) => i % 4 === 0))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("handles odd dimensions by rounding chroma size up", () => {
    // 3x3 I420: chroma planes are 2x2 (step 3 -> chroma step 2)
    const data = new Uint8Array([
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9],
      ...[128, 128, 128, 128],
      ...[128, 128, 128, 128],
    ]);
    const output = new Uint8ClampedArray(3 * 3 * 4);
    decodeYUV420(data, 3, 3, 3, "i420", output);
    // Neutral chroma -> grayscale equal to Y
    expect(Array.from(output.filter((_, i) => i % 4 === 0))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("rejects truncated data and invalid row step", () => {
    const output = new Uint8ClampedArray(4 * 2 * 4);
    expect(() => {
      decodeYUV420(new Uint8Array(11), 4, 2, 4, "i420", output);
    }).toThrow("YUV420 (i420) image data is truncated: expected at least 12 bytes, got 11");
    expect(() => {
      decodeYUV420(new Uint8Array(12), 4, 2, 3, "nv12", output);
    }).toThrow("YUV420 (nv12) image row step (3) must be at least 4");
    // Odd width: the last NV12/NV21 chroma pair needs an even row step
    expect(() => {
      decodeYUV420(new Uint8Array(100), 3, 2, 3, "nv21", output);
    }).toThrow("YUV420 (nv21) image row step (3) must be at least 4");
  });
});

describe("decodeMono8", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = width + 2;
    const output = new Uint8ClampedArray(width * height * 4);
    decodeMono8(
      new Uint8Array([...[1, 2, 3, 4, 5, 6], ...[11, 12, 13, 14, 15, 16]]),
      width,
      height,
      step,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray([
        ...[1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255],
        ...[11, 11, 11, 255, 12, 12, 12, 255, 13, 13, 13, 255, 14, 14, 14, 255],
      ]),
    );
  });
  it("maps values through the color converter", () => {
    const output = new Uint8ClampedArray(2 * 4);
    decodeMono8(new Uint8Array([0, 255]), 2, 1, 2, output, {
      colorConverter: (value) => ({ r: value / 255, g: 0, b: 1 - value / 255, a: 1 }),
    });
    expect(output).toEqual(new Uint8ClampedArray([0, 0, 255, 255, 255, 0, 0, 255]));
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = width - 1;
    expect(() => {
      decodeMono8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: Uint8 image row step (3) must be at least width (4)]`,
    );
    expect(() => {
      decodeMono8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
    }).not.toThrow();
  });
});

describe("decodeMono16", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = 2 * width + 3;
    const output = new Uint8ClampedArray(width * height * 4);
    const defaultMax = 10_000;
    decodeMono16(
      new Uint8Array([
        ...uint16LE(1000),
        ...uint16LE(2000),
        ...uint16LE(3000),
        ...uint16LE(4000),
        77,
        88,
        99,
        ...uint16LE(1500),
        ...uint16LE(2500),
        ...uint16LE(3500),
        ...uint16LE(4500),
        77,
        88,
        99,
      ]),
      width,
      height,
      step,
      /*is_bigendian=*/ false,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray(
        [
          1000,
          1000,
          1000,
          defaultMax,
          2000,
          2000,
          2000,
          defaultMax,
          3000,
          3000,
          3000,
          defaultMax,
          4000,
          4000,
          4000,
          defaultMax,
          1500,
          1500,
          1500,
          defaultMax,
          2500,
          2500,
          2500,
          defaultMax,
          3500,
          3500,
          3500,
          defaultMax,
          4500,
          4500,
          4500,
          defaultMax,
        ].map((x) => (x / defaultMax) * 255),
      ),
    );
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = 2 * width - 1;
    expect(() => {
      decodeMono16(
        new Uint8Array([]),
        width,
        height,
        step,
        /*is_bigendian=*/ false,
        new Uint8ClampedArray([]),
      );
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: Uint16 image row step (7) must be at least 2*width (8)]`,
    );
    expect(() => {
      decodeMono16(
        new Uint8Array(width * height * 2),
        width,
        height,
        step + 1,
        /*is_bigendian=*/ false,
        new Uint8ClampedArray([]),
      );
    }).not.toThrow();
  });
});

describe("decodeFloat1c", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = 4 * width + 2;
    const output = new Uint8ClampedArray(width * height * 4);
    decodeFloat1c(
      new Uint8Array([
        ...float32LE(0.1),
        ...float32LE(0.2),
        ...float32LE(0.3),
        ...float32LE(0.4),
        88,
        99,
        ...float32LE(1.1),
        ...float32LE(1.2),
        ...float32LE(1.3),
        ...float32LE(1.4),
        88,
        99,
      ]),
      width,
      height,
      step,
      /*is_bigendian=*/ false,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray(
        [
          ...[0.1, 0.1, 0.1, 1, 0.2, 0.2, 0.2, 1, 0.3, 0.3, 0.3, 1, 0.4, 0.4, 0.4, 1],
          ...[1.1, 1.1, 1.1, 1, 1.2, 1.2, 1.2, 1, 1.3, 1.3, 1.3, 1, 1.4, 1.4, 1.4, 1],
        ].map((x) => new Float32Array([x])[0]! * 255),
      ),
    );
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = 4 * width - 1;
    expect(() => {
      decodeFloat1c(
        new Uint8Array([]),
        width,
        height,
        step,
        /*is_bigendian=*/ false,
        new Uint8ClampedArray([]),
      );
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: Float image row step (15) must be at least 4*width (16)]`,
    );
    expect(() => {
      decodeFloat1c(
        new Uint8Array(width * height * 4),
        width,
        height,
        step + 1,
        /*is_bigendian=*/ false,
        new Uint8ClampedArray([]),
      );
    }).not.toThrow();
  });
});

describe("decodeUYVY", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = 2 * width + 2;
    const output = new Uint8ClampedArray(width * height * 4);
    decodeUYVY(
      new Uint8Array([
        ...[0, 1, 0, 2, 0, 11, 0, 12, 88, 99],
        ...[0, 21, 255, 22, 255, 31, 0, 32, 88, 99],
      ]),
      width,
      height,
      step,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray([
        0, 136, 0, 255, 0, 137, 0, 255, 0, 146, 0, 255, 0, 147, 0, 255, 199, 0, 0, 255, 200, 0, 0,
        255, 0, 79, 255, 255, 0, 80, 255, 255,
      ]),
    );
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = 2 * width - 1;
    expect(() => {
      decodeUYVY(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: UYVY image row step (7) must be at least 2*width (8)]`,
    );

    expect(() => {
      decodeUYVY(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
    }).not.toThrow();
  });
});

describe("decodeYUYV", () => {
  it("supports row step", () => {
    const width = 4;
    const height = 2;
    const step = 2 * width + 2;
    const output = new Uint8ClampedArray(width * height * 4);
    decodeYUYV(
      new Uint8Array([
        ...[1, 0, 2, 0, 11, 0, 12, 0, 88, 99],
        ...[21, 0, 22, 255, 31, 255, 32, 0, 88, 99],
      ]),
      width,
      height,
      step,
      output,
    );
    expect(output).toEqual(
      new Uint8ClampedArray([
        ...[0, 136, 0, 255, 0, 137, 0, 255, 0, 146, 0, 255, 0, 147, 0, 255],
        ...[199, 0, 0, 255, 200, 0, 0, 255, 0, 79, 255, 255, 0, 80, 255, 255],
      ]),
    );
  });
  it("rejects invalid row step", () => {
    const width = 4;
    const height = 2;
    const step = 2 * width - 1;
    expect(() => {
      decodeYUYV(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: YUYV image row step (7) must be at least 2*width (8)]`,
    );
    expect(() => {
      decodeYUYV(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
    }).not.toThrow();
  });
});

describe("decodeBayer*()", () => {
  // All the tests below have the same expected output and just rearrange the input pixels accordingly
  const decodeBayerExpectedOutput = new Uint8ClampedArray([
    ...[12, 2, 1, 255, 12, 2, 1, 255, 14, 4, 3, 255, 14, 4, 3, 255],
    ...[12, 11, 1, 255, 12, 11, 1, 255, 14, 13, 3, 255, 14, 13, 3, 255],
    ...[32, 22, 21, 255, 32, 22, 21, 255, 34, 24, 23, 255, 34, 24, 23, 255],
    ...[32, 31, 21, 255, 32, 31, 21, 255, 34, 33, 23, 255, 34, 33, 23, 255],
  ]);

  describe("decodeBayerBGGR8", () => {
    it("supports row step", () => {
      const width = 4;
      const height = 4;
      const step = width + 2;
      const output = new Uint8ClampedArray(width * height * 4);
      decodeBayerBGGR8(
        new Uint8Array([
          ...[1, 2, 3, 4, 88, 99],
          ...[11, 12, 13, 14, 88, 99],
          ...[21, 22, 23, 24, 88, 99],
          ...[31, 32, 33, 34, 88, 99],
        ]),
        width,
        height,
        step,
        output,
      );
      expect(output).toEqual(decodeBayerExpectedOutput);
    });
    it("rejects invalid row step", () => {
      const width = 4;
      const height = 4;
      const step = width - 1;
      expect(() => {
        decodeBayerBGGR8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: Bayer image row step (3) must be at least width (4)]`,
      );
      expect(() => {
        decodeBayerBGGR8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
      }).not.toThrow();
    });
  });

  describe("decodeBayerGBRG8", () => {
    it("supports row step", () => {
      const width = 4;
      const height = 4;
      const step = width + 2;
      const output = new Uint8ClampedArray(width * height * 4);
      decodeBayerGBRG8(
        new Uint8Array([
          ...[2, 1, 4, 3, 88, 99],
          ...[12, 11, 14, 13, 88, 99],
          ...[22, 21, 24, 23, 88, 99],
          ...[32, 31, 34, 33, 88, 99],
        ]),
        width,
        height,
        step,
        output,
      );
      expect(output).toEqual(decodeBayerExpectedOutput);
    });
    it("rejects invalid row step", () => {
      const width = 4;
      const height = 4;
      const step = width - 1;
      expect(() => {
        decodeBayerGBRG8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: Bayer image row step (3) must be at least width (4)]`,
      );
      expect(() => {
        decodeBayerGBRG8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
      }).not.toThrow();
    });
  });

  describe("decodeBayerGRBG8", () => {
    it("supports row step", () => {
      const width = 4;
      const height = 4;
      const step = width + 2;
      const output = new Uint8ClampedArray(width * height * 4);
      decodeBayerGRBG8(
        new Uint8Array([
          ...[2, 12, 4, 14, 88, 99],
          ...[1, 11, 3, 13, 88, 99],
          ...[22, 32, 24, 34, 88, 99],
          ...[21, 31, 23, 33, 88, 99],
        ]),
        width,
        height,
        step,
        output,
      );
      expect(output).toEqual(decodeBayerExpectedOutput);
    });
    it("rejects invalid row step", () => {
      const width = 4;
      const height = 4;
      const step = width - 1;
      expect(() => {
        decodeBayerGRBG8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: Bayer image row step (3) must be at least width (4)]`,
      );
      expect(() => {
        decodeBayerGRBG8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
      }).not.toThrow();
    });
  });

  describe("decodeBayerRGGB8", () => {
    it("supports row step", () => {
      const width = 4;
      const height = 4;
      const step = width + 2;
      const output = new Uint8ClampedArray(width * height * 4);
      decodeBayerRGGB8(
        new Uint8Array([
          ...[12, 2, 14, 4, 88, 99],
          ...[11, 1, 13, 3, 88, 99],
          ...[32, 22, 34, 24, 88, 99],
          ...[31, 21, 33, 23, 88, 99],
        ]),
        width,
        height,
        step,
        output,
      );
      expect(output).toEqual(decodeBayerExpectedOutput);
    });
    it("rejects invalid row step", () => {
      const width = 4;
      const height = 4;
      const step = width - 1;
      expect(() => {
        decodeBayerRGGB8(new Uint8Array([]), width, height, step, new Uint8ClampedArray([]));
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: Bayer image row step (3) must be at least width (4)]`,
      );
      expect(() => {
        decodeBayerRGGB8(new Uint8Array([]), width, height, step + 1, new Uint8ClampedArray([]));
      }).not.toThrow();
    });
  });
});
