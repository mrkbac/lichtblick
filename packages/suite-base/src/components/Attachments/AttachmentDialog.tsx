// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { formatByteSize } from "@lichtblick/den/format";
import { useAsync } from "@lichtblick/hooks";
import { downloadFiles } from "@lichtblick/suite-base/util/download";
import { fontMonospace } from "@lichtblick/theme";

import {
  PreviewKind,
  attachmentData,
  formatText,
  hexDump,
  previewKind,
  readAttachmentIndexes,
} from "./attachments";

const TEXT_LIMIT = 1024 * 1024;
const HEX_LIMIT = 4096;

const useStyles = makeStyles()((theme) => ({
  content: {
    display: "flex",
    justifyContent: "center",
    minHeight: 160,
  },
  media: {
    maxWidth: "100%",
    maxHeight: "70vh",
    objectFit: "contain",
  },
  note: {
    marginRight: "auto",
    marginLeft: theme.spacing(2),
  },
  pdf: {
    width: "100%",
    height: "70vh",
    border: "none",
  },
  code: {
    margin: 0,
    width: "100%",
    maxHeight: "70vh",
    overflow: "auto",
    padding: theme.spacing(1),
    fontFamily: fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    backgroundColor: theme.palette.action.hover,
    borderRadius: theme.shape.borderRadius,
    whiteSpace: "pre",
  },
}));

type Preview = { kind: PreviewKind; data: Blob; text?: string; truncated: boolean };

async function loadPreview(file: Blob, attachmentIndex: number): Promise<Preview> {
  const index = (await readAttachmentIndexes(file))[attachmentIndex];
  if (!index) {
    throw new Error("The attachment is no longer in the file.");
  }
  const data = attachmentData(file, index);
  const head = new Uint8Array(await data.slice(0, HEX_LIMIT).arrayBuffer());
  const kind = previewKind(index.mediaType, head);
  if (kind === "text") {
    const text = await data.slice(0, TEXT_LIMIT).text();
    return {
      kind,
      data,
      text: formatText(text, index.mediaType),
      truncated: data.size > TEXT_LIMIT,
    };
  }
  if (kind === "binary") {
    return { kind, data, text: hexDump(head), truncated: data.size > HEX_LIMIT };
  }
  return { kind, data, truncated: false };
}

function ObjectUrlPreview({ kind, data }: { kind: PreviewKind; data: Blob }): React.JSX.Element {
  const { classes } = useStyles();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    // oxlint-disable-next-line @lichtblick/no-object-url -- revoked on unmount
    const created = URL.createObjectURL(data);
    setUrl(created);
    return () => {
      URL.revokeObjectURL(created);
    };
  }, [data]);
  if (!url) {
    return <></>;
  }
  switch (kind) {
    case "image":
      return <img className={classes.media} src={url} alt="" />;
    case "video":
      return <video className={classes.media} src={url} controls />;
    case "audio":
      return <audio src={url} controls />;
    default:
      // <object> shows its children where the browser can't render PDFs inline.
      return (
        <object className={classes.pdf} data={url} type="application/pdf">
          <Typography color="text.secondary">
            This browser cannot show PDFs inline. Download the attachment to open it.
          </Typography>
        </object>
      );
  }
}

export function AttachmentDialog({
  file,
  attachmentIndex,
  name,
  mediaType,
  sizeBytes,
  onClose,
}: {
  file: Blob;
  attachmentIndex: number;
  name: string;
  mediaType: string;
  sizeBytes: number;
  onClose: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const preview = useAsync(
    async () => await loadPreview(file, attachmentIndex),
    [file, attachmentIndex],
  );
  const value = preview.value;

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {name}
        <Typography variant="body2" color="text.secondary">
          {mediaType || "No media type"} · {formatByteSize(sizeBytes)}
        </Typography>
      </DialogTitle>
      <DialogContent className={classes.content}>
        {preview.loading && <CircularProgress size={24} />}
        {preview.error && <Typography color="error">{preview.error.message}</Typography>}
        {value?.text != undefined && (
          <pre className={classes.code} aria-label="Attachment contents">
            {value.text}
          </pre>
        )}
        {value && value.text == undefined && (
          <ObjectUrlPreview kind={value.kind} data={value.data} />
        )}
      </DialogContent>
      <DialogActions>
        {value?.truncated === true && (
          <Typography variant="caption" color="text.secondary" className={classes.note}>
            Showing the first {formatByteSize(value.kind === "text" ? TEXT_LIMIT : HEX_LIMIT)}.
            Download for the whole attachment.
          </Typography>
        )}
        <Button
          disabled={!value}
          onClick={() => {
            if (value) {
              downloadFiles([
                { blob: value.data, fileName: name.split("/").pop() ?? "attachment" },
              ]);
            }
          }}
        >
          Download
        </Button>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
