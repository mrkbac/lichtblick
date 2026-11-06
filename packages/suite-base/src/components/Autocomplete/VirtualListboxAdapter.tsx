// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AutocompleteRenderOptionState } from "@mui/material/Autocomplete";
import MenuItem from "@mui/material/MenuItem";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FzfResultItem } from "fzf";
import React, { useMemo, useRef } from "react";
import { makeStyles } from "tss-react/mui";

import { HighlightChars } from "@lichtblick/suite-base/components/HighlightChars";

const Constants = Object.freeze({
  LISTBOX_PADDING: 8,
  ROW_HEIGHT: 26,
});

const useStyles = makeStyles()((theme) => ({
  item: {
    padding: 6,
    cursor: "pointer",
    minHeight: "100%",
    lineHeight: "calc(100% - 10px)",
    overflowWrap: "break-word",
    color: theme.palette.text.primary,

    // re-establish the <mark /> styles because the autocomplete is in a Portal
    mark: {
      backgroundColor: "transparent",
      color: theme.palette.info.main,
      fontWeight: 700,
    },
  },
  itemHighlighted: {
    backgroundColor: theme.palette.action.hover,
  },
}));

/** The type of each child component from the Autocomplete */
export type ListboxAdapterChild = [
  React.HTMLAttributes<HTMLLIElement>,
  FzfResultItem,
  AutocompleteRenderOptionState,
];

/**
 * Adapter to use a virtualized list as the autocomplete ListboxComponent to support
 * lists with thousands of elements without rendering all of them to the DOM.
 *
 * From the Autocomplete parent it receives a list of children (which must conform to the
 * ListboxAdapterChild type), and props to apply to the outer listbox element.
 */
export const VirtualListboxAdapter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLElement>
>(function ListboxComponent(props, ref) {
  const { children, ...other } = props;
  const { className, ...rest } = other;

  const options = children as ListboxAdapterChild[];
  const { classes, cx } = useStyles();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => Constants.ROW_HEIGHT,
    paddingStart: Constants.LISTBOX_PADDING,
    overscan: 3,
  });

  const longestChild = useMemo(
    () =>
      options.reduce((prev, item) => {
        if (item[1].item.length > prev.length) {
          return item[1].item;
        }
        return prev;
      }, ""),
    [options],
  );

  const totalHeight =
    2 * Constants.LISTBOX_PADDING + Constants.ROW_HEIGHT * Math.min(options.length, 16);

  // The hidden div is a trick to cause the parent div to expand to the width of the longest child
  // in the list. Without this, the parent div would have a width of 0 because the virtualized list
  // places items using position absolute which means they do not impact the size of their parent.
  return (
    <div ref={ref} {...rest}>
      <div style={{ visibility: "hidden", height: 0 }}>{longestChild}</div>
      <div
        ref={scrollRef}
        className={className}
        style={{ position: "relative", height: totalHeight, width: "100%", overflowY: "auto" }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const [optProps, item, opt] = options[virtualRow.index]!;
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <MenuItem
                  {...optProps}
                  dense
                  component="span"
                  data-highlighted={opt.selected}
                  data-testid="autocomplete-item"
                  className={cx(classes.item, {
                    [classes.itemHighlighted]: opt.selected,
                  })}
                >
                  <HighlightChars str={item.item} indices={item.positions} />
                </MenuItem>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
