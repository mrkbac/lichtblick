// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { FROM_COLOR, FrameMeasureCard, TO_COLOR } from "./FrameMeasureCard";
import type { Renderer } from "./Renderer";
import { useRendererEvent } from "./RendererContext";
import type { FrameAxes } from "./renderables/FrameAxes";
import { frameTransform } from "./renderables/measure/geometry";
import {
  clearFrames,
  findMissingLink,
  FRAME_MEASUREMENT_VARIABLE,
  FrameMeasurement,
  MissingLink,
  parseFrameMeasurement,
  pickFrame,
  Pose,
} from "./transforms/frameMeasurement";

const HOVER_COLOR = "#7fb3ff";
const HOVER_PICK_INTERVAL_MS = 50;

const tempMatrix = new THREE.Matrix4();
const tempPos = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const tempScale = new THREE.Vector3();

type Result = { pose?: Pose; missing?: MissingLink | "unavailable" };

/** Pose of `to` in `from` at the renderer's current time, or why there is none */
function measureInRenderer(renderer: Renderer, from: string, to: string): Result {
  const tree = renderer.transformTree;
  if (!frameTransform(tempMatrix, tree, from, renderer.fixedFrameId, to, renderer.currentTime)) {
    const missing = findMissingLink(
      from,
      to,
      (frame) => tree.frame(frame)?.parent()?.id,
      (frame) => tree.hasFrame(frame),
    );
    // Connected but no transform at this time (e.g. outside the stored history)
    return { missing: missing ?? "unavailable" };
  }
  tempMatrix.decompose(tempPos, tempQuat, tempScale);
  return {
    pose: { position: tempPos.toArray(), rotation: tempQuat.toArray() },
  };
}

function frameIds(renderer: Renderer): string[] {
  return [...renderer.transformTree.frames().keys()].sort();
}

/**
 * Frame-to-frame measurement in the 3D panel. The pair lives in a layout variable, so every 3D and
 * Transform Tree panel shows and edits the same one. While `picking`, clicks on a frame's axes or
 * label pick From, then To.
 */
export function FrameMeasureOverlay({
  renderer,
  picking,
  onStopPicking,
}: {
  renderer: Renderer;
  picking: boolean;
  onStopPicking: () => void;
}): React.JSX.Element | undefined {
  const [measurement, setLocalMeasurement] = useState(() =>
    parseFrameMeasurement(renderer.variables.get(FRAME_MEASUREMENT_VARIABLE)),
  );
  const [frames, setFrames] = useState(() => frameIds(renderer));
  const [result, setResult] = useState<Result>({});
  const [hovered, setHovered] = useState<string | undefined>();

  useRendererEvent(
    "variablesChange",
    useCallback((variables) => {
      const next = parseFrameMeasurement(variables.get(FRAME_MEASUREMENT_VARIABLE));
      setLocalMeasurement((previous) => (_.isEqual(previous, next) ? previous : next));
    }, []),
    renderer,
  );
  useRendererEvent(
    "transformTreeUpdated",
    useCallback(() => {
      const next = frameIds(renderer);
      setFrames((previous) => (_.isEqual(previous, next) ? previous : next));
    }, [renderer]),
    renderer,
  );

  // Clicks read the latest pair, which may not have come back through the layout yet
  const latest = useRef(measurement);
  useEffect(() => {
    latest.current = measurement;
  }, [measurement]);
  const setMeasurement = useCallback(
    (next: FrameMeasurement) => {
      latest.current = next;
      setLocalMeasurement(next);
      renderer.emit("setVariable", FRAME_MEASUREMENT_VARIABLE, next, renderer);
    },
    [renderer],
  );

  // Follow the latest transforms and playback time
  const { from, to } = measurement;
  const update = useCallback(() => {
    const next = from != undefined && to != undefined ? measureInRenderer(renderer, from, to) : {};
    setResult((previous) => (_.isEqual(previous, next) ? previous : next));
  }, [from, renderer, to]);
  useEffect(update, [update]);
  useRendererEvent("endFrame", update, renderer);

  // Picking: clicks on a frame fill From, then To; hovering highlights the frame a click would pick
  // FrameAxes.extensionId; a type-only import keeps the scene extensions out of this module
  const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes | undefined;
  useEffect(() => {
    if (!picking || !frameAxes) {
      return;
    }
    renderer.framePicking = true;
    const frameAt = (cursor: THREE.Vector2) => frameAxes.frameIdOf(renderer.pickObject(cursor));
    const onClick = (cursor: THREE.Vector2) => {
      const frame = frameAt(cursor);
      if (frame == undefined) {
        return;
      }
      const current = latest.current;
      const base =
        current.from != undefined && current.to != undefined ? clearFrames(current) : current;
      const next = pickFrame(base, frame);
      setMeasurement(next);
      if (next.from != undefined && next.to != undefined) {
        onStopPicking();
      }
    };
    const onMove = _.throttle((cursor: THREE.Vector2) => {
      setHovered(frameAt(cursor));
    }, HOVER_PICK_INTERVAL_MS);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onStopPicking();
      }
    };
    renderer.input.on("click", onClick);
    renderer.input.on("mousemove", onMove);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      renderer.framePicking = false;
      renderer.input.off("click", onClick);
      renderer.input.off("mousemove", onMove);
      window.removeEventListener("keydown", onKeyDown);
      onMove.cancel();
      setHovered(undefined);
    };
  }, [frameAxes, onStopPicking, picking, renderer, setMeasurement]);

  useEffect(() => {
    const highlights = new Map<string, string>();
    if (hovered != undefined) {
      highlights.set(hovered, HOVER_COLOR);
    }
    if (from != undefined) {
      highlights.set(from, FROM_COLOR);
    }
    if (to != undefined) {
      highlights.set(to, TO_COLOR);
    }
    frameAxes?.setLabelHighlights(highlights);
  }, [frameAxes, from, hovered, to]);
  useEffect(() => () => frameAxes?.setLabelHighlights(new Map()), [frameAxes]);

  if (!picking && from == undefined && to == undefined) {
    return undefined;
  }
  const pickingEnd = picking ? (from == undefined || to != undefined ? "from" : "to") : undefined;
  return (
    <FrameMeasureCard
      frames={frames}
      measurement={measurement}
      onChange={setMeasurement}
      onClose={() => {
        onStopPicking();
        setMeasurement(clearFrames(measurement));
      }}
      pose={result.pose}
      missing={result.missing}
      pickingEnd={pickingEnd}
    />
  );
}
