// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef } from "react";
import StatsMonitor from "stats.js";
import type { WebGLInfo } from "three";

import type { Renderer } from "./Renderer";
import { useRendererEvent } from "./RendererContext";

export function Stats(): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const update = useRef<((renderer: Renderer) => void) | undefined>(undefined);

  useRendererEvent("endFrame", (_event, renderer) => update.current?.(renderer));

  useEffect(() => {
    const element = container.current;
    if (!element) {
      return;
    }
    const stats = new StatsMonitor();
    stats.dom.style.position = "relative";
    stats.dom.style.zIndex = "auto";
    const counters = [
      ["draws", "red", (info: WebGLInfo) => info.render.calls],
      ["tris", "cyan", (info: WebGLInfo) => info.render.triangles],
      ["textures", "yellow", (info: WebGLInfo) => info.memory.textures],
      ["geometries", "green", (info: WebGLInfo) => info.memory.geometries],
    ] as const;
    const panels = counters.map(([name, color]) =>
      stats.addPanel(new StatsMonitor.Panel(name, color, "black")),
    );
    const maxima = counters.map(() => 0);
    element.appendChild(stats.dom);
    stats.showPanel(1);
    update.current = (renderer) => {
      counters.forEach(([, , value], index) => {
        const current = value(renderer.gl.info);
        maxima[index] = Math.max(maxima[index]!, current);
        panels[index]!.update(current, maxima[index]);
      });
      stats.update();
    };
    return () => {
      update.current = undefined;
      stats.dom.remove();
    };
  }, []);

  return <div ref={container} />;
}
