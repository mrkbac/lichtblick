// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PointerEvent, useEffect, useState } from "react";
import { makeStyles } from "tss-react/mui";

/** Attribute on each item of a Stack panel, holding its index. */
export const STACK_ITEM_ATTRIBUTE = "data-stack-index";

const RAIL_WIDTH = 10;

const useStyles = makeStyles()((theme) => ({
  rail: {
    position: "relative",
    flex: "none",
    touchAction: "none",
    cursor: "pointer",
  },
  railY: { width: RAIL_WIDTH, marginLeft: theme.spacing(0.25) },
  railX: { height: RAIL_WIDTH, marginTop: theme.spacing(0.25) },
  segment: {
    position: "absolute",
    borderRadius: 2,
    backgroundColor: theme.palette.action.selected,
    transition: "background-color 80ms",
    "&:hover": { backgroundColor: theme.palette.text.disabled },
  },
  segmentY: { left: 2, right: 2 },
  segmentX: { top: 2, bottom: 2 },
  inView: { backgroundColor: theme.palette.text.disabled },
  thumb: {
    position: "absolute",
    inset: 0,
    border: `1px solid ${theme.palette.text.secondary}`,
    borderRadius: 3,
    pointerEvents: "none",
  },
}));

type Segment = { start: number; size: number; indices: number[] };
type Metrics = { total: number; view: number; pos: number; segments: Segment[] };

function measure(scroller: HTMLElement, axis: "x" | "y"): Metrics {
  const horizontal = axis === "x";
  const segments: Segment[] = [];
  // Only this stack's own items, not those of a stack nested in one.
  for (const element of scroller.querySelectorAll<HTMLElement>(`[${STACK_ITEM_ATTRIBUTE}]`)) {
    if (element.offsetParent !== scroller) {
      continue;
    }
    const start = horizontal ? element.offsetLeft : element.offsetTop;
    const size = horizontal ? element.offsetWidth : element.offsetHeight;
    const index = Number(element.getAttribute(STACK_ITEM_ATTRIBUTE));
    // Items in one grid row share a segment.
    const row = segments.find((segment) => segment.start === start);
    if (row) {
      row.indices.push(index);
    } else {
      segments.push({ start, size, indices: [index] });
    }
  }
  return horizontal
    ? {
        total: scroller.scrollWidth,
        view: scroller.clientWidth,
        pos: scroller.scrollLeft,
        segments,
      }
    : {
        total: scroller.scrollHeight,
        view: scroller.clientHeight,
        pos: scroller.scrollTop,
        segments,
      };
}

type Props = {
  scroller: HTMLElement | null;
  horizontal: boolean;
  /** Names of the items, by index. */
  titles: readonly string[];
};

/**
 * Stands in for the scrollbar of a Stack panel: a bar per item (per row in a grid) with the shown
 * part outlined. Panels such as plots take the mouse wheel, so this is where the stack scrolls:
 * wheel over it, drag along it, or click an item's bar to bring the item into view.
 */
export function ScrollRail({ scroller, horizontal, titles }: Props): React.JSX.Element | null {
  const { classes, cx } = useStyles();
  const [metrics, setMetrics] = useState<Metrics | undefined>(undefined);

  useEffect(() => {
    if (scroller == undefined) {
      return undefined;
    }
    const update = () => {
      setMetrics(measure(scroller, horizontal ? "x" : "y"));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (scroller.firstElementChild) {
      observer.observe(scroller.firstElementChild);
    }
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scroller, horizontal, titles]);

  if (scroller == undefined || metrics == undefined || metrics.total <= metrics.view + 1) {
    return null;
  }
  const { total, view, pos, segments } = metrics;
  const percent = (value: number) => `${(value / total) * 100}%`;
  const place = (start: number, size: number) =>
    horizontal
      ? { left: percent(start), width: percent(size) }
      : { top: percent(start), height: percent(size) };

  const scrollTo = (offset: number, behavior: ScrollBehavior) => {
    scroller.scrollTo({
      [horizontal ? "left" : "top"]: offset,
      behavior,
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const rail = event.currentTarget;
    rail.setPointerCapture(event.pointerId);
    const rect = rail.getBoundingClientRect();
    const length = horizontal ? rect.width : rect.height;
    const at = (e: { clientX: number; clientY: number }) =>
      horizontal ? e.clientX - rect.left : e.clientY - rect.top;
    const startAt = at(event);
    const segment = (event.target as HTMLElement).dataset.segment;
    let dragging = false;
    // Dragging keeps the outlined part centered on the pointer.
    const centerOn = (point: number, behavior: ScrollBehavior) => {
      scrollTo((point / length) * total - view / 2, behavior);
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      dragging ||= Math.abs(at(moveEvent) - startAt) > 3;
      if (dragging) {
        centerOn(at(moveEvent), "instant");
      }
    };
    const up = () => {
      rail.removeEventListener("pointermove", move);
      rail.removeEventListener("pointerup", up);
      rail.removeEventListener("pointercancel", up);
      if (dragging) {
        return;
      }
      const clicked = segment == undefined ? undefined : segments[Number(segment)];
      if (clicked) {
        scrollTo(clicked.start, "smooth");
      } else {
        centerOn(startAt, "smooth");
      }
    };
    rail.addEventListener("pointermove", move);
    rail.addEventListener("pointerup", up);
    rail.addEventListener("pointercancel", up);
  };

  return (
    <div
      className={cx(classes.rail, horizontal ? classes.railX : classes.railY)}
      data-testid="stack-rail"
      onPointerDown={onPointerDown}
      onWheel={(event) => {
        scroller.scrollBy({
          [horizontal ? "left" : "top"]: horizontal ? event.deltaX + event.deltaY : event.deltaY,
        });
      }}
    >
      {segments.map((segment, i) => (
        <div
          key={segment.start}
          data-segment={i}
          title={segment.indices.map((index) => titles[index] ?? "").join(" | ")}
          className={cx(classes.segment, horizontal ? classes.segmentX : classes.segmentY, {
            [classes.inView]: segment.start < pos + view && segment.start + segment.size > pos,
          })}
          style={place(segment.start, segment.size)}
        />
      ))}
      <div className={classes.thumb} style={place(pos, view)} />
    </div>
  );
}
