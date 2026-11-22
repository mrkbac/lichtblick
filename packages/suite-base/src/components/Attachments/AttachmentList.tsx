// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatByteSize } from "@lichtblick/den/format";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { useExportableFile } from "@lichtblick/suite-base/components/ExportRecordingDialog/exportSource";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { selectRecordingFiles } from "@lichtblick/suite-base/components/MessagePipeline/selectors";

import { AttachmentDialog } from "./AttachmentDialog";
import { useStyles } from "./AttachmentList.style";
import { previewKind } from "./attachments";
import { PREVIEW_ICONS } from "./constants";

function iconFor(mediaType: string) {
  // Without the bytes, unknown types get the generic file icon.
  const known = mediaType !== "" && !/octet-stream/i.test(mediaType);
  return PREVIEW_ICONS[known ? previewKind(mediaType, new Uint8Array([0])) : "binary"];
}

/** Left sidebar tab listing the recording's attachments; a click previews one. */
export function AttachmentList(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("attachments");
  const files = useMessagePipeline(selectRecordingFiles) ?? [];
  const localFile = useExportableFile();
  // Attachment bytes are read from the local file; remote and compared files only list them.
  const viewableFile = files.length === 1 ? localFile : undefined;
  const attachments = files.flatMap((file) => file.attachments);
  const [viewing, setViewing] = useState<number>();
  const viewed = viewing != undefined ? attachments[viewing] : undefined;

  if (attachments.length === 0) {
    return <EmptyState>{t("noAttachments")}</EmptyState>;
  }
  return (
    <>
      {!viewableFile && (
        <Typography variant="caption" color="text.secondary" component="p" className={classes.note}>
          {t("needsLocalFile")}
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
                secondary={`${attachment.mediaType || t("noMediaType")} · ${formatByteSize(attachment.sizeBytes)}`}
                slotProps={{ primary: { noWrap: true, title: attachment.name } }}
              />
            </ListItemButton>
          );
        })}
      </List>
      {viewableFile && viewed && viewing != undefined && (
        <AttachmentDialog
          file={viewableFile}
          {...viewed}
          onClose={() => {
            setViewing(undefined);
          }}
        />
      )}
    </>
  );
}
