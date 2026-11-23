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
import { useTranslation } from "react-i18next";

import { formatByteSize } from "@lichtblick/den/format";
import { useAsync } from "@lichtblick/hooks";
import CopyButton from "@lichtblick/suite-base/components/CopyButton";
import { downloadFiles } from "@lichtblick/suite-base/util/download";

import { useStyles } from "./AttachmentDialog.style";
import { AttachmentInfo, attachmentData, formatText, hexDump, previewKind } from "./attachments";
import { HEX_PREVIEW_BYTES, TEXT_PREVIEW_BYTES } from "./constants";
import { AttachmentDialogProps, Preview, PreviewKind } from "./types";

/** Undefined when the file no longer has the attachment where it was. */
async function loadPreview(file: Blob, attachment: AttachmentInfo): Promise<Preview | undefined> {
  const data = await attachmentData(file, attachment);
  if (!data) {
    return undefined;
  }
  const head = new Uint8Array(await data.slice(0, HEX_PREVIEW_BYTES).arrayBuffer());
  const kind = previewKind(attachment.mediaType, head);
  if (kind === "text") {
    const text = await data.slice(0, TEXT_PREVIEW_BYTES).text();
    return {
      kind,
      data,
      text: formatText(text, attachment.mediaType),
      truncated: data.size > TEXT_PREVIEW_BYTES,
    };
  }
  if (kind === "binary") {
    return { kind, data, text: hexDump(head), truncated: data.size > HEX_PREVIEW_BYTES };
  }
  return { kind, data, truncated: false };
}

function ObjectUrlPreview({ kind, data }: { kind: PreviewKind; data: Blob }): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("attachments");
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
          <Typography color="text.secondary">{t("noPdfViewer")}</Typography>
        </object>
      );
  }
}

export function AttachmentDialog({
  file,
  name,
  mediaType,
  sizeBytes,
  offset,
  onClose,
}: AttachmentDialogProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("attachments");
  const preview = useAsync(
    async () => await loadPreview(file, { name, mediaType, sizeBytes, offset }),
    [file, name, mediaType, sizeBytes, offset],
  );
  const value = preview.value;
  const missing = !preview.loading && !preview.error && !value;

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {name}
        <Typography variant="body2" color="text.secondary">
          {mediaType || t("noMediaType")} · {formatByteSize(sizeBytes)}
        </Typography>
      </DialogTitle>
      <DialogContent className={classes.content}>
        {preview.loading && <CircularProgress size={24} />}
        {preview.error && <Typography color="error">{preview.error.message}</Typography>}
        {missing && <Typography color="error">{t("missing")}</Typography>}
        {value?.text != undefined && (
          <pre className={classes.code} aria-label={t("attachmentContents")}>
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
            {t("truncated", {
              size: formatByteSize(value.kind === "text" ? TEXT_PREVIEW_BYTES : HEX_PREVIEW_BYTES),
            })}
          </Typography>
        )}
        {value?.kind === "text" && value.text != undefined && (
          <CopyButton getText={() => value.text ?? ""}>{t("copy")}</CopyButton>
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
          {t("download")}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t("close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
