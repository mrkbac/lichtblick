// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import BookmarksIcon from "@mui/icons-material/BookmarksOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {
  Button,
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  inputBaseClasses,
} from "@mui/material";
import { useMemo, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@lichtblick/suite";
import Stack from "@lichtblick/suite-base/components/Stack";
import { usePrompt } from "@lichtblick/suite-base/hooks/usePrompt";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { customTypography } from "@lichtblick/theme";

import { MessageForm, canShowForm } from "./MessageForm";
import { ParsedMessage, sampleMessageJson, stringifyMessage } from "./messageJson";

export type MessageEditorMode = "form" | "json";

/** A named message saved in the panel config. */
export type MessagePreset = { name: string; value: string };

type Props = {
  datatypes: Immutable<RosDatatypes>;
  schemaName: string | undefined;
  /** Message as JSON text */
  value: string;
  /** Result of parseMessageJson(value), shared with the panel so it parses only once */
  parsed: ParsedMessage;
  onChange: (value: string) => void;
  mode: MessageEditorMode;
  onModeChange: (mode: MessageEditorMode) => void;
  presets: readonly MessagePreset[];
  onPresetsChange: (presets: MessagePreset[]) => void;
};

const useStyles = makeStyles()((theme) => ({
  toggle: {
    paddingTop: theme.spacing(0.25),
    paddingBottom: theme.spacing(0.25),
  },
  deletePreset: {
    marginLeft: theme.spacing(2),
  },
  body: {
    flex: "auto",
    minHeight: 0,
    overflow: "auto",
  },
  textarea: {
    height: "100%",

    [`.${inputBaseClasses.root}`]: {
      height: "100%",
      alignItems: "stretch",
      backgroundColor: theme.palette.background.paper,
      padding: theme.spacing(1, 0.5),

      [`.${inputBaseClasses.input}`]: {
        height: "100% !important",
        lineHeight: 1.4,
        fontFamily: customTypography.fontMonospace,
        overflow: "auto !important",
        resize: "none",
      },
    },
  },
}));

/**
 * Editor for a message or service request: a form generated from the message definition, with a
 * raw JSON mode, presets and a reset-to-template action.
 */
export function MessageEditor(props: Props): React.JSX.Element {
  const { datatypes, schemaName, value, parsed, onChange, mode, onModeChange } = props;
  const { classes } = useStyles();
  const formAvailable = canShowForm(datatypes, schemaName);
  const showForm = mode === "form" && formAvailable && parsed.value != undefined;
  const template = useMemo(() => sampleMessageJson(datatypes, schemaName), [datatypes, schemaName]);

  let body: React.JSX.Element;
  if (showForm) {
    body = (
      <MessageForm
        datatypes={datatypes}
        schemaName={schemaName!}
        value={parsed.value}
        onChange={(newValue) => {
          onChange(stringifyMessage(newValue));
        }}
      />
    );
  } else if (mode === "form" && formAvailable) {
    body = (
      <Stack gap={1} alignItems="flex-start">
        <Typography variant="body2" color="error">
          The form cannot show invalid JSON: {parsed.error}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            onModeChange("json");
          }}
        >
          Fix in JSON
        </Button>
      </Stack>
    );
  } else {
    body = (
      <TextField
        variant="outlined"
        className={classes.textarea}
        multiline
        size="small"
        fullWidth
        placeholder="Enter the message as JSON"
        value={value}
        error={parsed.error != undefined}
        slotProps={{ htmlInput: { "aria-label": "Message JSON", spellCheck: false } }}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }

  return (
    <Stack flex="auto" gap={1} overflow="hidden">
      <Stack direction="row" alignItems="center" gap={0.5}>
        <Tooltip title={formAvailable ? "" : "No message definition available for a form"}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={formAvailable ? mode : "json"}
            disabled={!formAvailable}
            onChange={(_event, newMode: MessageEditorMode | null) => {
              if (newMode) {
                onModeChange(newMode);
              }
            }}
          >
            <ToggleButton value="form" className={classes.toggle}>
              Form
            </ToggleButton>
            <ToggleButton value="json" className={classes.toggle}>
              JSON
            </ToggleButton>
          </ToggleButtonGroup>
        </Tooltip>
        <Stack flex="auto" />
        <PresetMenu
          presets={props.presets}
          onPresetsChange={props.onPresetsChange}
          value={value}
          parsed={parsed}
          onChange={onChange}
        />
        {template != undefined && (
          <Tooltip title="Reset to an empty template">
            <span>
              <IconButton
                size="small"
                aria-label="Reset to template"
                disabled={value === template}
                onClick={() => {
                  onChange(template);
                }}
              >
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>
      <div className={classes.body}>{body}</div>
    </Stack>
  );
}

function PresetMenu(
  props: Pick<Props, "presets" | "onPresetsChange" | "value" | "parsed" | "onChange">,
): React.JSX.Element {
  const { presets, onPresetsChange, value, parsed, onChange } = props;
  const [anchor, setAnchor] = useState<HTMLElement>();
  const { classes } = useStyles();
  const [prompt, promptModal] = usePrompt();

  const savePreset = async () => {
    setAnchor(undefined);
    const name = (
      await prompt({ title: "Save preset", label: "Name", placeholder: "My message" })
    )?.trim();
    if (!name) {
      return;
    }
    // Saving under an existing name updates that preset
    onPresetsChange([...presets.filter((p) => p.name !== name), { name, value }]);
  };

  return (
    <>
      <Tooltip title="Presets">
        <IconButton
          size="small"
          aria-label="Presets"
          onClick={(event) => {
            setAnchor(event.currentTarget);
          }}
        >
          <BookmarksIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={anchor != undefined}
        onClose={() => {
          setAnchor(undefined);
        }}
      >
        {presets.map((preset) => (
          <MenuItem
            key={preset.name}
            selected={preset.value === value}
            onClick={() => {
              onChange(preset.value);
              setAnchor(undefined);
            }}
          >
            <ListItemText>{preset.name}</ListItemText>
            <IconButton
              size="small"
              edge="end"
              aria-label={`Delete preset ${preset.name}`}
              className={classes.deletePreset}
              onClick={(event) => {
                event.stopPropagation();
                onPresetsChange(presets.filter((p) => p !== preset));
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </MenuItem>
        ))}
        {presets.length === 0 && (
          <MenuItem disabled>
            <ListItemText secondary="Save messages you send often" />
          </MenuItem>
        )}
        <Divider />
        <MenuItem disabled={parsed.value == undefined} onClick={() => void savePreset()}>
          Save current as preset…
        </MenuItem>
      </Menu>
      {promptModal}
    </>
  );
}
