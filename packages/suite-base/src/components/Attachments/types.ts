// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { ExportSource } from "@lichtblick/suite-base/components/ExportRecordingDialog/exportSource";

import type { AttachmentInfo } from "./attachments";

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "binary";

/** A loaded attachment; `text` is set for text and hex previews. */
export type Preview = { kind: PreviewKind; data: Blob; text?: string; truncated: boolean };

export type AttachmentDialogProps = AttachmentInfo & {
  /** The recording the attachment is read from: a local file, or a source that opens a remote one. */
  file: Blob | ExportSource;
  onClose: () => void;
};
