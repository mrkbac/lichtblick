// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, subtract, toSec } from "@foxglove/rostime";
import { Button, Chip, Typography } from "@mui/material";
import { Fragment, useState } from "react";

import { formatByteSize } from "@lichtblick/den/format";
import { Immutable } from "@lichtblick/suite";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { RecordingFileInfo } from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import { useStyles } from "./index.style";
import { bucketTime } from "./inspection";

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;

function PlaybackMarker({ start, end }: { start: Time; end: Time }): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const current = useMessagePipeline(selectCurrentTime);
  const duration = toSec(subtract(end, start));
  if (!current || duration <= 0) {
    return undefined;
  }
  const position = Math.max(0, Math.min(1, toSec(subtract(current, start)) / duration));
  return (
    <span
      className={classes.playhead}
      style={{ left: `${position * 100}%` }}
      aria-hidden
      title="Current playback position"
    />
  );
}

export function ActivityChart({
  buckets,
  start,
  end,
  label,
  variant = "topic",
  onSeek,
}: {
  buckets: readonly number[];
  start: Time;
  end: Time;
  label: string;
  variant?: "topic" | "overview";
  onSeek?: (time: Time) => void;
}): React.JSX.Element {
  const { classes, cx } = useStyles();
  const max = Math.max(1, ...buckets);
  const duration = toSec(subtract(end, start));
  return (
    <>
      <div className={cx(classes.chart, variant === "overview" && classes.overviewChart)}>
        {buckets.map((count, index) => {
          const time = bucketTime(start, end, index);
          const offset = toSec(subtract(time, start)).toFixed(2);
          const title = `${label}: ${count.toLocaleString()} messages at +${offset} s`;
          return (
            <button
              key={index}
              type="button"
              title={title}
              aria-label={title}
              disabled={!onSeek}
              onClick={() => onSeek?.(time)}
              style={{
                height: count > 0 ? `${Math.max(8, (count / max) * 100)}%` : "2px",
                opacity: count > 0 ? 1 : 0.15,
              }}
            />
          );
        })}
        {variant === "overview" && <PlaybackMarker start={start} end={end} />}
      </div>
      {variant === "overview" && (
        <div className={classes.axis}>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <span key={fraction}>+{(duration * fraction).toFixed(1)} s</span>
          ))}
        </div>
      )}
    </>
  );
}

export function KeyValueTable({
  values,
}: {
  values: Readonly<Record<string, string>>;
}): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <dl className={classes.properties}>
      {Object.entries(values).map(([key, value]) => (
        <Fragment key={key}>
          <dt>{key}</dt>
          <dd>{value || "—"}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function SchemaFields({
  schemaName,
  datatypes,
}: {
  schemaName: string;
  datatypes: Immutable<RosDatatypes>;
}): React.JSX.Element {
  const { classes, cx } = useStyles();
  const [activeSchema, setActiveSchema] = useState(schemaName);
  const fields = datatypes.get(activeSchema)?.definitions;
  if (!fields) {
    return (
      <Typography variant="body2" color="textSecondary">
        No decoded field definitions available.
      </Typography>
    );
  }
  return (
    <>
      <div className={classes.chartHeading}>
        <Typography variant="caption" color="textSecondary">
          {activeSchema}
        </Typography>
        {activeSchema !== schemaName && (
          <Button
            size="small"
            onClick={() => {
              setActiveSchema(schemaName);
            }}
          >
            Root schema
          </Button>
        )}
      </div>
      <div className={classes.tableWrap}>
        <table className={classes.table}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Shape</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => (
              <tr key={index}>
                <td>
                  <code>{field.name}</code>
                </td>
                <td>
                  {field.isComplex === true && datatypes.has(field.type) ? (
                    <button
                      className={cx(classes.topicButton, classes.size)}
                      onClick={() => {
                        setActiveSchema(field.type);
                      }}
                    >
                      {field.type} →
                    </button>
                  ) : (
                    <code className={classes.size}>{field.type}</code>
                  )}
                </td>
                <td>
                  <Typography variant="caption" color="textSecondary">
                    {field.isConstant === true
                      ? `Constant ${field.valueText ?? String(field.value ?? "")}`
                      : field.isArray === true
                        ? `Array [${field.arrayLength ?? "variable"}]`
                        : "Scalar"}
                  </Typography>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {fields.length === 0 && (
          <Typography variant="body2" color="textSecondary" className={classes.emptyNote}>
            This schema has no fields.
          </Typography>
        )}
      </div>
    </>
  );
}

export function ContainerDetails({
  files,
}: {
  files: readonly Immutable<RecordingFileInfo>[];
}): React.JSX.Element {
  const { classes } = useStyles();
  if (files.length === 0) {
    return (
      <Typography color="textSecondary" className={classes.emptyNoteY}>
        File details are available for indexed MCAP files.
      </Typography>
    );
  }
  return (
    <>
      {files.map((file, index) => {
        const compressed = file.compression.reduce((sum, group) => sum + group.compressedBytes, 0);
        const uncompressed = file.compression.reduce(
          (sum, group) => sum + group.uncompressedBytes,
          0,
        );
        return (
          <section className={classes.details} key={index}>
            <div className={classes.heading}>
              <Typography variant="subtitle2">
                {files.length > 1 ? `File ${index + 1}` : "File information"}
              </Typography>
              <Chip label="Indexed" color="info" variant="outlined" size="small" />
            </div>
            <KeyValueTable
              values={{
                Writer: file.library || "Not specified",
                "File size":
                  file.sizeBytes != undefined ? formatByteSize(file.sizeBytes) : "Unavailable",
                Channels: String(file.channels.length),
                Schemas: String(file.schemaCount),
                Attachments: String(file.attachments.length),
                "Compression ratio":
                  uncompressed > 0
                    ? `${(uncompressed / Math.max(1, compressed)).toFixed(2)}×`
                    : "—",
              }}
            />
            <Typography variant="subtitle2" className={classes.subheading}>
              Compression
            </Typography>
            <div className={classes.tableWrap}>
              <table className={classes.table}>
                <thead>
                  <tr>
                    <th>Codec</th>
                    <th>Compressed</th>
                    <th>Uncompressed</th>
                    <th>Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {file.compression.map((group) => (
                    <tr key={group.format}>
                      <td>
                        <Chip label={group.format.toUpperCase()} size="small" variant="outlined" />
                      </td>
                      <td className={classes.numeric}>{formatByteSize(group.compressedBytes)}</td>
                      <td className={classes.numeric}>{formatByteSize(group.uncompressedBytes)}</td>
                      <td className={classes.count}>
                        {group.uncompressedBytes > 0
                          ? `${(100 * (1 - group.compressedBytes / group.uncompressedBytes)).toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {file.attachments.length > 0 && (
              <>
                <Typography variant="subtitle2" className={classes.subheading}>
                  Attachments
                </Typography>
                <div className={classes.tableWrap}>
                  <table className={classes.table}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Media type</th>
                        <th>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {file.attachments.map((attachment, attachmentIndex) => (
                        <tr key={attachmentIndex}>
                          <td>{attachment.name}</td>
                          <td>{attachment.mediaType}</td>
                          <td>{formatByteSize(attachment.sizeBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}
