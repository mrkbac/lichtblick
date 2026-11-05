// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Checkmark20Regular, Edit20Regular } from "@fluentui/react-icons";
import { Button, Typography } from "@mui/material";
import {
  ChangeEvent,
  createContext,
  KeyboardEvent,
  MouseEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Options } from "react-markdown";
import { makeStyles } from "tss-react/mui";
import { useDebouncedCallback } from "use-debounce";

import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import TextContent from "@lichtblick/suite-base/components/TextContent";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { formatKeyboardShortcut } from "@lichtblick/suite-base/util/formatKeyboardShortcut";
import { customTypography } from "@lichtblick/theme";

import { useNotesSettings } from "./settings";
import { toggleTask } from "./toggleTask";
import { NotesConfig } from "./types";

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[] };

/** Visible text of a list item, without its nested lists: the accessible name of its task box. */
function itemText(node: HastNode): string {
  if (node.type === "text") {
    return node.value ?? "";
  }
  if (node.tagName === "ul" || node.tagName === "ol") {
    return "";
  }
  return (node.children ?? []).map(itemText).join("");
}

/** Passes each task item's text down to its checkbox. */
const TaskLabelContext = createContext<string | undefined>(undefined);

function TaskCheckbox(props: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  const label = useContext(TaskLabelContext);
  return <input {...props} disabled={undefined} readOnly aria-label={label} />;
}

/** Each save writes the layout, so batch keystrokes. */
export const SAVE_DEBOUNCE_MS = 500;

const useStyles = makeStyles()(({ palette, spacing, typography }) => ({
  content: {
    flex: "auto",
    overflow: "auto",
    padding: spacing(1, 1.5),
  },
  editor: {
    flex: "auto",
    resize: "none",
    border: "none",
    outline: "none",
    margin: 0,
    padding: spacing(1, 1.5),
    fontFamily: customTypography.fontMonospace,
    fontSize: typography.body2.fontSize,
    lineHeight: 1.5,
    color: palette.text.primary,
    backgroundColor: palette.background.paper,
    "&::placeholder": { color: palette.text.disabled },
  },
  hint: {
    padding: spacing(0.25, 1.5),
    borderTop: `1px solid ${palette.divider}`,
    color: palette.text.secondary,
    fontSize: typography.caption.fontSize,
  },
}));

type Props = {
  config: NotesConfig;
  saveConfig: SaveConfig<NotesConfig>;
};

export function Notes({ config, saveConfig }: Props): React.JSX.Element {
  const { t } = useTranslation("notes");
  const { classes } = useStyles();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(config.text);

  useNotesSettings(config, saveConfig);

  const save = useDebouncedCallback((text: string) => {
    saveConfig({ text });
  }, SAVE_DEBOUNCE_MS);

  // Never lose pending keystrokes when the panel goes away (layout switch, panel removed).
  useEffect(
    () => () => {
      save.flush();
    },
    [save],
  );

  // Focus the editor with the cursor at the end, where people usually continue writing.
  const editorRef = useCallback((el: HTMLTextAreaElement | null) => {
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const startEditing = () => {
    setDraft(config.text);
    setEditing(true);
  };

  const finishEditing = () => {
    save.flush();
    setEditing(false);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    save(event.target.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      event.stopPropagation();
      finishEditing();
    }
  };

  const onDoubleClick = (event: MouseEvent) => {
    // Let double-clicks on links and checkboxes do their own thing.
    if (!(event.target as HTMLElement).closest("a, input")) {
      startEditing();
    }
  };

  // Task-list checkboxes are clickable in view mode and write back to the Markdown.
  const components = useMemo<Options["components"]>(
    () => ({
      input: ({ node: _node, ...props }) => <TaskCheckbox {...props} />,
      li: ({ node, children, ...props }) => {
        const offset = node?.position?.start.offset;
        return (
          <li
            {...props}
            onChange={(event) => {
              const target = event.target as unknown as HTMLInputElement;
              if (offset == undefined || target.type !== "checkbox") {
                return;
              }
              event.stopPropagation(); // nested lists: only the innermost item owns the box
              saveConfig({ text: toggleTask(config.text, offset) });
            }}
          >
            <TaskLabelContext.Provider value={node ? itemText(node).trim() : undefined}>
              {children}
            </TaskLabelContext.Provider>
          </li>
        );
      },
    }),
    [config.text, saveConfig],
  );

  const fontStyle = config.fontSize == undefined ? undefined : { fontSize: config.fontSize };

  let body: React.ReactNode;
  if (editing) {
    body = (
      <>
        <textarea
          aria-label={t("edit")}
          className={classes.editor}
          style={fontStyle}
          ref={editorRef}
          spellCheck
          value={draft}
          placeholder={t("placeholder")}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={save.flush}
        />
        <div className={classes.hint}>
          {t("editHint", { shortcut: formatKeyboardShortcut("Enter", ["Meta"]) })}
        </div>
      </>
    );
  } else if (config.text.trim() === "") {
    body = (
      <div className={classes.content} onDoubleClick={startEditing}>
        <Stack fullHeight alignItems="center" justifyContent="center" gap={1}>
          <Typography variant="body2" color="text.secondary" align="center">
            {t("emptyTitle")}
          </Typography>
          <Button variant="contained" size="small" onClick={startEditing}>
            {t("startWriting")}
          </Button>
          <Typography variant="caption" color="text.disabled">
            {t("emptyHint")}
          </Typography>
        </Stack>
      </div>
    );
  } else {
    body = (
      <div className={classes.content} onDoubleClick={onDoubleClick} data-testid="notes-view">
        <TextContent style={fontStyle} components={components}>
          {config.text}
        </TextContent>
      </div>
    );
  }

  return (
    <Stack fullHeight>
      <PanelToolbar
        additionalIcons={
          <ToolbarIconButton
            title={editing ? t("done") : t("edit")}
            onClick={editing ? finishEditing : startEditing}
          >
            {editing ? <Checkmark20Regular /> : <Edit20Regular />}
          </ToolbarIconButton>
        }
      />
      {body}
    </Stack>
  );
}
