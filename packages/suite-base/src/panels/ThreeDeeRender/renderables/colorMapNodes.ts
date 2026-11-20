// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// GPU (TSL) versions of the color maps in colorMode.ts. Kept apart from colorMode.ts, which the
// image decoder worker imports and which must not pull in three/webgpu.
// sRGB -> linear on the GPU is three's `sRGBTransferEOTF` from "three/tsl".

import {
  Fn,
  clamp,
  dot,
  floor,
  fract,
  select,
  sRGBTransferEOTF,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type * as THREE from "three/webgpu";

/** Turbo color map, linear RGB; matches `turboLinear` in colorMode.ts */
export const turboLinear = Fn(([pct]: [THREE.Node<"float">]) => {
  // adapted from https://gist.github.com/mikhailov-work/0d177465a8151eb6ede1768d51d476c7
  const x = clamp(pct, 0, 1).mul(0.99).add(0.01);
  const v4 = vec4(1, x, x.mul(x), x.mul(x).mul(x));
  const v2 = v4.zw.mul(v4.z);
  const srgb = vec3(
    dot(v4, vec4(0.13572138, 4.6153926, -42.66032258, 132.13108234)).add(
      dot(v2, vec2(-152.94239396, 59.28637943)),
    ),
    dot(v4, vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333)).add(
      dot(v2, vec2(4.27729857, 2.82956604)),
    ),
    dot(v4, vec4(0.1066733, 12.64194608, -60.58204836, 110.36276771)).add(
      dot(v2, vec2(-89.90310912, 27.34824973)),
    ),
  );
  return sRGBTransferEOTF(clamp(srgb, 0, 1)) as THREE.Node<"vec3">;
});

/** rviz rainbow color map, linear RGB; matches `rainbowLinear` in colorMode.ts */
export const rainbowLinear = Fn(([pct]: [THREE.Node<"float">]) => {
  const h = clamp(pct, 0, 1).oneMinus().mul(5).add(1);
  const i = floor(h);
  const f = fract(h);
  // n ramps down on odd segments and up on even ones
  const n = select(i.mod(2).lessThan(1), f, f.oneMinus());
  return sRGBTransferEOTF(
    select(
      i.lessThanEqual(1),
      vec3(n, 0, 1),
      select(
        i.equal(2),
        vec3(0, n, 1),
        select(i.equal(3), vec3(0, 1, n), select(i.equal(4), vec3(n, 1, 0), vec3(1, n, 0))),
      ),
    ),
  ) as THREE.Node<"vec3">;
});
