// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { RecordingFileInfo } from "@lichtblick/suite-base/players/types";

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "binary";

/** A loaded attachment; `text` is set for text and hex previews. */
export type Preview = { kind: PreviewKind; data: Blob; text?: string; truncated: boolean };

export type AttachmentDialogProps = RecordingFileInfo["attachments"][number] & {
  /** The local recording file the attachment is read from. */
  file: Blob;
  onClose: () => void;
};
