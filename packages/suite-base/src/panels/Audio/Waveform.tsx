// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useTheme } from "@mui/material";
import { useEffect, useRef } from "react";

import { AudioPlayer } from "./AudioPlayer";

const MAX_COLUMNS = 4096;

/**
 * Scrolling peak envelope of what is audible right now (one column per animation frame), plus
 * a level meter on the right. Freezes while the audio clock is paused.
 */
export function Waveform({ player }: { player: AudioPlayer | undefined }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  const waveColor = theme.palette.primary.main;
  const axisColor = theme.palette.divider;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !player) {
      return;
    }
    const peaks = new Float32Array(MAX_COLUMNS);
    const samples = new Float32Array(player.analyser.fftSize);
    let head = 0;
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (!player.isRunning()) {
        return;
      }
      player.analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
      }
      peaks[head] = Math.min(peak, 1);
      head = (head + 1) % MAX_COLUMNS;

      const dpr = window.devicePixelRatio;
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
      const meterWidth = 4 * dpr;
      const plotWidth = width - meterWidth * 2;
      const mid = height / 2;
      ctx.fillStyle = axisColor;
      ctx.fillRect(0, mid, plotWidth, Math.max(1, dpr));

      ctx.fillStyle = waveColor;
      const columns = Math.min(Math.floor(plotWidth / dpr), MAX_COLUMNS);
      for (let i = 0; i < columns; i++) {
        const value = peaks[(head - 1 - i + MAX_COLUMNS) % MAX_COLUMNS]!;
        const h = Math.max(dpr, value * height);
        ctx.fillRect(plotWidth - (i + 1) * dpr, mid - h / 2, dpr, h);
      }
      const level = peaks[(head - 1 + MAX_COLUMNS) % MAX_COLUMNS]!;
      ctx.fillStyle = level >= 0.99 ? theme.palette.error.main : waveColor;
      ctx.fillRect(width - meterWidth, height * (1 - level), meterWidth, height * level);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [player, waveColor, axisColor, theme.palette.error.main]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
