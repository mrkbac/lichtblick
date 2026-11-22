// SPDX-License-Identifier: MPL-2.0

import ChevronDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { IconButton, Menu, MenuItem } from "@mui/material";
import { RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** The `[role=tab]` elements in `strip` that are cut off by its visible area. */
export function hiddenTabs(strip: HTMLElement): HTMLElement[] {
  const view = strip.getBoundingClientRect();
  return [...strip.querySelectorAll<HTMLElement>("[role=tab]")].filter((tab) => {
    const rect = tab.getBoundingClientRect();
    return rect.left < view.left - 1 || rect.right > view.right + 1;
  });
}

/** The tab's name as a screen reader reads it. */
export function tabLabel(tab: HTMLElement): string {
  return tab.getAttribute("aria-label") ?? tab.textContent;
}

const sameTabs = (a: readonly HTMLElement[], b: readonly HTMLElement[]) =>
  a.length === b.length && a.every((tab, i) => tab === b[i]);

/**
 * For a tab strip that scrolls sideways when its tabs don't fit: a button listing the tabs that are
 * out of view, which scrolls to and selects the picked one. It renders nothing while every tab fits.
 * The vertical mouse wheel also scrolls the strip. Works with any tabs that have `role="tab"` and
 * select on click (MUI Tabs, the Tab panel).
 */
export function TabOverflowMenu({
  stripRef,
  className,
}: {
  /** Element whose box is the visible area of the tabs; the scroller may be inside it. */
  stripRef: RefObject<HTMLElement | null>;
  className?: string;
}): React.JSX.Element | undefined {
  const { t } = useTranslation("general");
  const [hidden, setHidden] = useState<HTMLElement[]>([]);
  const [anchor, setAnchor] = useState<HTMLElement | undefined>(undefined);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return undefined;
    }
    const update = () => {
      const next = hiddenTabs(strip);
      setHidden((prev) => (sameTabs(prev, next) ? prev : next));
    };
    // Tabs change size with their titles and badges, so each tab is observed, not just the strip.
    const resizeObserver = new ResizeObserver(update);
    const observeTabs = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(strip);
      for (const tab of strip.querySelectorAll("[role=tab]")) {
        resizeObserver.observe(tab);
      }
    };
    const mutationObserver = new MutationObserver(() => {
      observeTabs();
      update();
    });
    mutationObserver.observe(strip, { childList: true, subtree: true });
    observeTabs();

    // A mouse wheel only scrolls vertically; turn that into sideways scrolling of the strip.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener("scroll", update, { capture: true, passive: true });
    strip.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      strip.removeEventListener("scroll", update, { capture: true });
      strip.removeEventListener("wheel", onWheel);
    };
  }, [stripRef]);

  if (hidden.length === 0) {
    return undefined;
  }
  return (
    <>
      <IconButton
        size="small"
        className={className}
        aria-label={t("moreTabs", { count: hidden.length })}
        title={t("moreTabs", { count: hidden.length })}
        aria-haspopup="menu"
        aria-expanded={anchor != undefined}
        onClick={(event) => {
          setAnchor(event.currentTarget);
        }}
      >
        <ChevronDownIcon fontSize="inherit" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor != undefined}
        onClose={() => {
          setAnchor(undefined);
        }}
      >
        {hidden.map((tab, index) => (
          <MenuItem
            // Tabs have no ids of their own; the order is stable while the menu is open.
            key={index}
            dense
            selected={tab.getAttribute("aria-selected") === "true"}
            onClick={() => {
              setAnchor(undefined);
              tab.scrollIntoView({ block: "nearest", inline: "nearest" });
              tab.click();
            }}
          >
            {tabLabel(tab)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
