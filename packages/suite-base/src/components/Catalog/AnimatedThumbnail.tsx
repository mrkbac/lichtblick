// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { readCachedPreview } from "./indexFolder";
import { PREVIEW_FPS, PreviewFrame } from "./preview";
import { CatalogRecording } from "./types";

const useStyles = makeStyles()((theme) => ({
  root: {
    overflow: "hidden",
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.action.hover,
  },
  scrub: {
    cursor: "ew-resize",
  },
  image: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
}));

// Clips shown in several places at once (a row and its popover) are read once. Recent clips are
// kept so scrolling back doesn't read them again; the oldest are dropped past the limit.
const CLIP_CACHE_LIMIT = 200;
const clips = new Map<string, Promise<PreviewFrame[] | undefined>>();

async function clipFor(recording: CatalogRecording): Promise<PreviewFrame[] | undefined> {
  const key = `${recording.previewKey}|${recording.previewTopics?.[0]}`;
  let clip = clips.get(key);
  if (!clip) {
    clip = readCachedPreview(recording).catch((err: unknown) => {
      console.warn("Catalog preview cache read failed", err);
      return undefined;
    });
    clips.set(key, clip);
    if (clips.size > CLIP_CACHE_LIMIT) {
      clips.delete(clips.keys().next().value!);
    }
  }
  return await clip;
}

type Props = {
  recording: CatalogRecording;
  className?: string;
  /** Seek by the cursor's horizontal position while hovering. */
  scrub?: boolean;
};

/** A recording's thumbnail that plays its cached preview clip while it is on screen. */
export function AnimatedThumbnail({
  recording,
  className,
  scrub = false,
}: Props): React.JSX.Element {
  const { classes, cx } = useStyles();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [frames, setFrames] = useState<PreviewFrame[]>();
  const [index, setIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number>();

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry?.isIntersecting ?? false);
    });
    observer.observe(ref.current!);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible || frames) {
      return;
    }
    let cancelled = false;
    void clipFor(recording).then((clip) => {
      if (!cancelled) {
        setFrames(clip);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, frames, recording]);

  useEffect(() => {
    if (!visible || !frames || frames.length < 2 || hoverIndex != undefined) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, 1000 / PREVIEW_FPS);
    return () => {
      clearInterval(timer);
    };
  }, [visible, frames, hoverIndex]);

  const src = frames?.[hoverIndex ?? index]?.url ?? recording.thumbnail;
  return (
    <div
      ref={ref}
      className={cx(classes.root, { [classes.scrub]: scrub && frames != undefined }, className)}
      onMouseMove={
        scrub && frames && frames.length > 0
          ? (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientX - rect.left) / rect.width;
              setHoverIndex(
                Math.min(frames.length - 1, Math.max(0, Math.floor(ratio * frames.length))),
              );
            }
          : undefined
      }
      onMouseLeave={() => {
        setHoverIndex(undefined);
      }}
    >
      {src != undefined && <img src={src} alt="" className={classes.image} />}
    </div>
  );
}
