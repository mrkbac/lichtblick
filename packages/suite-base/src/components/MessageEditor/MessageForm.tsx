// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinitionField } from "@foxglove/message-definition";
import AddIcon from "@mui/icons-material/Add";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Autocomplete, Checkbox, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@lichtblick/suite";
import { NumberInput } from "@lichtblick/suite-base/components/SettingsTreeEditor/inputs/NumberInput";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { customTypography } from "@lichtblick/theme";

import buildSampleMessage from "./buildSampleMessage";

type Field = Immutable<MessageDefinitionField>;
type Datatypes = Immutable<RosDatatypes>;
type MessageObject = Record<string, unknown>;

const INTEGER_RANGES: Record<string, [min: number, max: number]> = {
  int8: [-128, 127],
  uint8: [0, 255],
  byte: [0, 255],
  char: [0, 255],
  int16: [-32768, 32767],
  uint16: [0, 65535],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  int64: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  uint64: [0, Number.MAX_SAFE_INTEGER],
};
const FLOAT_TYPES = new Set(["float32", "float64"]);

// ROS 1 builtin time types are not part of the datatypes map
const TIME_FIELDS: Field[] = [
  { name: "sec", type: "int32" },
  { name: "nsec", type: "uint32" },
];

// ponytail: larger arrays are edited as one JSON value to keep the form fast; add virtualization
// if people need to edit long arrays item by item.
const MAX_FORM_ARRAY_ITEMS = 50;

const useStyles = makeStyles()((theme) => ({
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(80px, max-content) minmax(120px, 1fr)",
    alignItems: "center",
    columnGap: theme.spacing(1.5),
    rowGap: theme.spacing(0.75),
  },
  label: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    maxWidth: 220,
  },
  type: {
    fontFamily: customTypography.fontMonospace,
    color: theme.palette.text.secondary,
    lineHeight: 1.2,
  },
  group: {
    gridColumn: "1 / -1",
    minWidth: 0,
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    marginLeft: theme.spacing(-0.75),
  },
  groupBody: {
    marginLeft: theme.spacing(0.75),
    paddingLeft: theme.spacing(1.25),
    paddingTop: theme.spacing(0.5),
    borderLeft: `1px solid ${theme.palette.divider}`,
  },
  checkbox: {
    justifySelf: "start",
    padding: theme.spacing(0.5),
  },
  monospace: {
    fontFamily: customTypography.fontMonospace,
  },
}));

function isRecord(value: unknown): value is MessageObject {
  return value != undefined && typeof value === "object" && !Array.isArray(value);
}

/** Fields and constants of a complex type, or undefined for primitive / unknown types. */
function definitionOf(
  datatypes: Datatypes,
  type: string,
): { fields: readonly Field[]; constants: readonly Field[] } | undefined {
  if (type === "time" || type === "duration") {
    return { fields: TIME_FIELDS, constants: [] };
  }
  const definitions = datatypes.get(type)?.definitions;
  if (!definitions) {
    return undefined;
  }
  return {
    fields: definitions.filter((f) => f.isConstant !== true),
    constants: definitions.filter((f) => f.isConstant === true),
  };
}

/** True if a form can be shown for the schema. */
export function canShowForm(datatypes: Datatypes, schemaName: string | undefined): boolean {
  return schemaName != undefined && definitionOf(datatypes, schemaName) != undefined;
}

type MessageFormProps = {
  datatypes: Datatypes;
  schemaName: string;
  value: MessageObject;
  onChange: (value: MessageObject) => void;
  /** Called with the number of fields holding invalid input that is not reflected in `value` */
  onInvalidFieldsChange?: (count: number) => void;
};

// Lets fields with their own draft text (e.g. JSON inputs) report that the draft is invalid
const ReportInvalidContext = createContext<(id: string, error: string | undefined) => void>(
  () => {},
);

/** Form for editing a message, generated from its message definition. */
export function MessageForm({
  datatypes,
  schemaName,
  value,
  onChange,
  onInvalidFieldsChange,
}: MessageFormProps): React.JSX.Element {
  const { classes } = useStyles();
  const definition = definitionOf(datatypes, schemaName);

  const [invalidIds, setInvalidIds] = useState<ReadonlySet<string>>(new Set());
  const reportInvalid = useCallback((id: string, error: string | undefined) => {
    setInvalidIds((old) => {
      if (old.has(id) === (error != undefined)) {
        return old;
      }
      const ids = new Set(old);
      if (error != undefined) {
        ids.add(id);
      } else {
        ids.delete(id);
      }
      return ids;
    });
  }, []);
  const latestOnInvalidFieldsChange = useRef(onInvalidFieldsChange);
  latestOnInvalidFieldsChange.current = onInvalidFieldsChange;
  useEffect(() => {
    latestOnInvalidFieldsChange.current?.(invalidIds.size);
  }, [invalidIds.size]);
  useEffect(
    () => () => {
      latestOnInvalidFieldsChange.current?.(0);
    },
    [],
  );

  if (!definition || definition.fields.length === 0) {
    return (
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
        }}
      >
        {definition ? "This message has no fields." : `Unknown schema ${schemaName}`}
      </Typography>
    );
  }
  return (
    <ReportInvalidContext.Provider value={reportInvalid}>
      <div className={classes.grid}>
        <Fields datatypes={datatypes} {...definition} value={value} onChange={onChange} />
      </div>
    </ReportInvalidContext.Provider>
  );
}

function Fields(props: {
  datatypes: Datatypes;
  fields: readonly Field[];
  constants: readonly Field[];
  value: MessageObject;
  onChange: (value: MessageObject) => void;
}): React.JSX.Element {
  const { datatypes, fields, constants, value, onChange } = props;
  return (
    <>
      {fields.map((field) => (
        <FieldEditor
          key={field.name}
          datatypes={datatypes}
          field={field}
          constants={constants}
          value={value[field.name]}
          onChange={(fieldValue) => {
            onChange({ ...value, [field.name]: fieldValue });
          }}
        />
      ))}
    </>
  );
}

function typeLabel(field: Field): string {
  if (field.isArray !== true) {
    return field.type;
  }
  return `${field.type}[${field.arrayLength ?? ""}]`;
}

function FieldLabel({ name, type }: { name: string; type?: string }): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <div className={classes.label}>
      <Typography variant="body2" noWrap title={name}>
        {name}
      </Typography>
      {type != undefined && (
        <Typography variant="caption" noWrap title={type} className={classes.type}>
          {type}
        </Typography>
      )}
    </div>
  );
}

function Group(props: {
  label: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const { classes, cx } = useStyles();
  const [open, setOpen] = useState(true);
  return (
    <div className={classes.group}>
      <div className={classes.groupHeader}>
        <IconButton
          size="small"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        </IconButton>
        {props.label}
        {props.actions}
      </div>
      {open && <div className={cx(classes.grid, classes.groupBody)}>{props.children}</div>}
    </div>
  );
}

function FieldEditor(props: {
  datatypes: Datatypes;
  field: Field;
  constants: readonly Field[];
  value: unknown;
  onChange: (value: unknown) => void;
}): React.JSX.Element {
  const { datatypes, field, constants, value, onChange } = props;

  if (field.isArray === true) {
    return <ArrayEditor datatypes={datatypes} field={field} value={value} onChange={onChange} />;
  }

  const nested = definitionOf(datatypes, field.type);
  if (nested) {
    return (
      <Group label={<FieldLabel name={field.name} type={field.type} />}>
        <Fields
          datatypes={datatypes}
          {...nested}
          value={isRecord(value) ? value : {}}
          onChange={onChange}
        />
      </Group>
    );
  }

  const fieldConstants = constants.filter((c) => c.type === field.type);
  const constantName = fieldConstants.find((c) => c.value === value)?.name;
  return (
    <>
      <FieldLabel
        name={field.name}
        type={constantName ? `${field.type} · ${constantName}` : field.type}
      />
      <PrimitiveInput
        name={field.name}
        type={field.type}
        constants={fieldConstants}
        value={value}
        onChange={onChange}
      />
    </>
  );
}

function ArrayEditor(props: {
  datatypes: Datatypes;
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.JSX.Element {
  const { datatypes, field, value, onChange } = props;
  const items = Array.isArray(value) ? (value as unknown[]) : [];
  const nested = definitionOf(datatypes, field.type);
  const isFixedLength = field.arrayLength != undefined;

  if (!nested || items.length > MAX_FORM_ARRAY_ITEMS) {
    return (
      <>
        <FieldLabel name={field.name} type={typeLabel(field)} />
        <JsonInput name={field.name} value={items} onChange={onChange} expectArray />
      </>
    );
  }

  return (
    <Group
      label={<FieldLabel name={`${field.name} (${items.length})`} type={typeLabel(field)} />}
      actions={
        !isFixedLength && (
          <Tooltip title="Add item">
            <IconButton
              size="small"
              aria-label={`Add ${field.name} item`}
              onClick={() => {
                onChange([...items, buildSampleMessage(datatypes, field.type)]);
              }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )
      }
    >
      {items.map((item, index) => (
        <Group
          // Items have no identity, so the index is the only key there is

          key={index}
          label={<FieldLabel name={`[${index}]`} />}
          actions={
            !isFixedLength && (
              <IconButton
                size="small"
                aria-label={`Remove ${field.name} item ${index}`}
                onClick={() => {
                  onChange(items.filter((_item, i) => i !== index));
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            )
          }
        >
          <Fields
            datatypes={datatypes}
            {...nested}
            value={isRecord(item) ? item : {}}
            onChange={(newItem) => {
              onChange(items.map((old, i) => (i === index ? newItem : old)));
            }}
          />
        </Group>
      ))}
    </Group>
  );
}

function PrimitiveInput(props: {
  name: string;
  type: string;
  constants: readonly Field[];
  value: unknown;
  onChange: (value: unknown) => void;
}): React.JSX.Element {
  const { name, type, constants, value, onChange } = props;
  const { classes } = useStyles();
  const isNumeric = INTEGER_RANGES[type] != undefined || FLOAT_TYPES.has(type);

  if (type === "bool") {
    return (
      <Checkbox
        size="small"
        className={classes.checkbox}
        checked={value === true}
        slotProps={{ input: { "aria-label": name } }}
        onChange={(_event, checked) => {
          onChange(checked);
        }}
      />
    );
  }

  if (constants.length > 0 && (isNumeric || type === "string")) {
    return (
      <EnumInput
        name={name}
        numeric={isNumeric}
        constants={constants}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (type === "string") {
    return (
      <TextField
        size="small"
        value={typeof value === "string" ? value : ""}
        slotProps={{ htmlInput: { "aria-label": name } }}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }

  if (isNumeric) {
    const range = INTEGER_RANGES[type];
    return (
      <NumberInput
        size="small"
        value={typeof value === "number" ? value : undefined}
        placeholder="0"
        step={range ? 1 : 0.1}
        precision={range ? 0 : 9}
        min={range?.[0]}
        max={range?.[1]}
        slotProps={{ htmlInput: { "aria-label": name } }}
        onChange={onChange}
      />
    );
  }

  return <JsonInput name={name} value={value} onChange={onChange} />;
}

/** Number or string input that suggests the message's constants, e.g. enum values. */
function EnumInput(props: {
  name: string;
  numeric: boolean;
  constants: readonly Field[];
  value: unknown;
  onChange: (value: unknown) => void;
}): React.JSX.Element {
  const { name, numeric, constants, value, onChange } = props;
  // Text being typed; undefined when not editing. Keeps partial input like "-" while typing.
  const [draft, setDraft] = useState<string>();
  const nameByValue = new Map(constants.map((c) => [String(c.value), c.name]));

  return (
    <Autocomplete
      freeSolo
      disableClearable
      size="small"
      options={[...nameByValue.keys()]}
      filterOptions={(options) => options}
      inputValue={
        draft ?? (typeof value === "number" || typeof value === "string" ? String(value) : "")
      }
      onInputChange={(_event, text, reason) => {
        setDraft(reason === "reset" ? undefined : text);
        if (!numeric) {
          onChange(text);
        } else if (text.trim() !== "" && Number.isFinite(Number(text))) {
          onChange(Number(text));
        }
      }}
      onBlur={() => {
        setDraft(undefined);
      }}
      renderOption={({ key, ...optionProps }, option) => (
        <li key={key} {...optionProps}>
          {nameByValue.get(option)}&nbsp;
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
            }}
          >
            = {option}
          </Typography>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, "aria-label": name },
          }}
        />
      )}
    />
  );
}

/** Edits any value as JSON text; used for primitive arrays and types without a definition. */
function JsonInput(props: {
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  expectArray?: boolean;
}): React.JSX.Element {
  const { name, value, onChange, expectArray = false } = props;
  const { classes } = useStyles();
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const reportInvalid = useContext(ReportInvalidContext);
  const id = useId();
  useEffect(() => {
    reportInvalid(id, error);
    return () => {
      reportInvalid(id, undefined);
    };
  }, [error, id, reportInvalid]);

  return (
    <TextField
      size="small"
      multiline
      maxRows={6}
      value={draft ?? JSON.stringify(value) ?? ""}
      error={error != undefined}
      helperText={error}
      slotProps={{ htmlInput: { "aria-label": name, className: classes.monospace } }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        try {
          const parsed: unknown = JSON.parse(text);
          if (expectArray && !Array.isArray(parsed)) {
            setError("Expected a JSON array");
            return;
          }
          setError(undefined);
          onChange(parsed);
        } catch {
          setError("Invalid JSON");
        }
      }}
      onBlur={() => {
        // Keep invalid text so it can be fixed rather than silently dropped
        if (error == undefined) {
          setDraft(undefined);
        }
      }}
    />
  );
}
