// SPDX-License-Identifier: MPL-2.0

import ChevronDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { IconButton, Menu, MenuItem } from "@mui/material";
import { RefObject, useEffect, useRef, useState } from "react";
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

/**
 * Whether the tabs in the scrolling `strip` don't fit. `reservedPx` is the width the overflow
 * button takes from the strip while shown: the tabs fit once they fit without it, so widening the
 * window hides the button even though the button itself narrowed the strip.
 */
export function tabsOverflow(strip: HTMLElement, reservedPx: number): boolean {
  return strip.scrollWidth - strip.clientWidth > reservedPx + 1;
}

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
  /** The element that scrolls the tabs sideways. */
  stripRef: RefObject<HTMLElement | null>;
  className?: string;
}): React.JSX.Element | undefined {
  const { t } = useTranslation("general");
  const [overflowing, setOverflowing] = useState(false);
  // The tabs out of view, taken when the menu opens
  const [menu, setMenu] = useState<{ anchor: HTMLElement; tabs: HTMLElement[] } | undefined>();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return undefined;
    }
    const update = () => {
      const next = tabsOverflow(strip, buttonRef.current?.offsetWidth ?? 0);
      setOverflowing(next);
      if (!next) {
        // The button unmounts; don't leave the menu anchored to it.
        setMenu(undefined);
      }
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
    strip.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      strip.removeEventListener("wheel", onWheel);
    };
  }, [stripRef]);

  if (!overflowing) {
    return undefined;
  }
  return (
    <>
      <IconButton
        ref={buttonRef}
        size="small"
        className={className}
        aria-label={t("moreTabs")}
        title={t("moreTabs")}
        aria-haspopup="menu"
        aria-expanded={menu != undefined}
        onClick={(event) => {
          const strip = stripRef.current;
          if (strip) {
            setMenu({ anchor: event.currentTarget, tabs: hiddenTabs(strip) });
          }
        }}
      >
        <ChevronDownIcon fontSize="inherit" />
      </IconButton>
      <Menu
        anchorEl={menu?.anchor}
        open={menu != undefined}
        onClose={() => {
          setMenu(undefined);
        }}
      >
        {menu?.tabs.map((tab, index) => (
          <MenuItem
            // Tabs have no ids of their own; the list is fixed while the menu is open.
            key={index}
            dense
            selected={tab.getAttribute("aria-selected") === "true"}
            onClick={() => {
              setMenu(undefined);
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
