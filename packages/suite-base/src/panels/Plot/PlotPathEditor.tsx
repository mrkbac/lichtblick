// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { parseMessagePath } from "@lichtblick/message-path";
import * as PanelAPI from "@lichtblick/suite-base/PanelAPI";
import MessagePathInput from "@lichtblick/suite-base/components/MessagePathSyntax/MessagePathInput";
import { messagePathStructures } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import { PLOTABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/shared/constants";

import { plottableFields } from "./utils/plottableFields";

// A message is accepted too: it adds one series per numeric field, e.g. x, y and z
const VALID_TYPES = [...PLOTABLE_ROS_TYPES, "message"];

const useStyles = makeStyles()({
  root: {
    // Wide enough for a path even in a narrow floating legend
    minWidth: 260,
    flex: "auto",
  },
});

/**
 * Inline message path input for a Plot legend row. Enter or leaving the field commits, Escape
 * cancels. A path to a message commits all of its numeric fields.
 */
export function PlotPathEditor({
  initialValue,
  placeholder,
  supportsStreamModifiers,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  placeholder: string;
  supportsStreamModifiers: boolean;
  onCommit: (paths: string[]) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const [value, setValue] = useState(initialValue);
  // Read in key handlers that run before React re-renders with a just-picked suggestion
  const latestValue = useRef(initialValue);
  const rootRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const { topics, datatypes } = PanelAPI.useDataSourceInfo();
  const structures = useMemo(() => messagePathStructures(datatypes), [datatypes]);

  useEffect(() => {
    rootRef.current?.querySelector("input")?.focus();
  }, []);

  const finish = (how: "commit" | "cancel") => {
    if (done.current) {
      return;
    }
    done.current = true;
    const path = latestValue.current.trim();
    if (
      how === "cancel" ||
      path === "" ||
      path === initialValue ||
      parseMessagePath(path) == undefined
    ) {
      onCancel();
      return;
    }
    onCommit(plottableFields(path, structures, topics) ?? [path]);
  };

  return (
    <div
      ref={rootRef}
      className={classes.root}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        // The suggestion list handles (and prevents) Enter and Escape while it has a choice open
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          finish("commit");
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish("cancel");
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          finish("commit");
        }
      }}
    >
      <MessagePathInput
        path={value}
        onChange={(newValue) => {
          latestValue.current = newValue;
          setValue(newValue);
        }}
        validTypes={VALID_TYPES}
        supportsMathModifiers
        supportsStreamModifiers={supportsStreamModifiers}
        placeholder={placeholder}
      />
    </div>
  );
}
