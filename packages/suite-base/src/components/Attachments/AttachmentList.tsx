// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AudioFileOutlinedIcon from "@mui/icons-material/AudioFileOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import MovieOutlinedIcon from "@mui/icons-material/MovieOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import { List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useState } from "react";
import { makeStyles } from "tss-react/mui";

import { formatByteSize } from "@lichtblick/den/format";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { useExportableFile } from "@lichtblick/suite-base/components/ExportRecordingDialog/exportRecording";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { selectRecordingFiles } from "@lichtblick/suite-base/components/MessagePipeline/selectors";

import { AttachmentDialog } from "./AttachmentDialog";
import { previewKind } from "./attachments";

const useStyles = makeStyles()((theme) => ({
  note: { padding: theme.spacing(1, 2) },
}));

const ICONS = {
  image: ImageOutlinedIcon,
  video: MovieOutlinedIcon,
  audio: AudioFileOutlinedIcon,
  pdf: PictureAsPdfOutlinedIcon,
  text: DescriptionOutlinedIcon,
  binary: InsertDriveFileOutlinedIcon,
};

function iconFor(mediaType: string) {
  // Without the bytes, unknown types get the generic file icon.
  const known = mediaType !== "" && !/octet-stream/i.test(mediaType);
  return ICONS[known ? previewKind(mediaType, new Uint8Array([0])) : "binary"];
}

/** Left sidebar tab listing the recording's attachments; a click previews one. */
export function AttachmentList(): React.JSX.Element {
  const { classes } = useStyles();
  const files = useMessagePipeline(selectRecordingFiles) ?? [];
  const localFile = useExportableFile();
  // Attachment bytes are read from the local file; remote and compared files only list them.
  const viewableFile = files.length === 1 ? localFile : undefined;
  const attachments = files.flatMap((file) => file.attachments);
  const [viewing, setViewing] = useState<number>();
  const viewed = viewing != undefined ? attachments[viewing] : undefined;

  if (attachments.length === 0) {
    return <EmptyState>This recording has no attachments.</EmptyState>;
  }
  return (
    <>
      {!viewableFile && (
        <Typography variant="caption" color="text.secondary" component="p" className={classes.note}>
          Previews need a single recording opened as a local file.
        </Typography>
      )}
      <List dense disablePadding>
        {attachments.map((attachment, index) => {
          const Icon = iconFor(attachment.mediaType);
          return (
            <ListItemButton
              key={index}
              disabled={!viewableFile}
              onClick={() => {
                setViewing(index);
              }}
            >
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={attachment.name}
                secondary={`${attachment.mediaType || "No media type"} · ${formatByteSize(attachment.sizeBytes)}`}
                slotProps={{ primary: { noWrap: true, title: attachment.name } }}
              />
            </ListItemButton>
          );
        })}
      </List>
      {viewableFile && viewed && viewing != undefined && (
        <AttachmentDialog
          file={viewableFile}
          attachmentIndex={viewing}
          {...viewed}
          onClose={() => {
            setViewing(undefined);
          }}
        />
      )}
    </>
  );
}
