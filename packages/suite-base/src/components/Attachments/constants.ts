// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AudioFileOutlinedIcon from "@mui/icons-material/AudioFileOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import MovieOutlinedIcon from "@mui/icons-material/MovieOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";

import { PreviewKind } from "./types";

/** Text previews show at most this many bytes. */
export const TEXT_PREVIEW_BYTES = 1024 * 1024;
/** Binary previews hex dump at most this many bytes; also how much is sniffed for text. */
export const HEX_PREVIEW_BYTES = 4096;

export const PREVIEW_ICONS: Record<PreviewKind, typeof ImageOutlinedIcon> = {
  image: ImageOutlinedIcon,
  video: MovieOutlinedIcon,
  audio: AudioFileOutlinedIcon,
  pdf: PictureAsPdfOutlinedIcon,
  text: DescriptionOutlinedIcon,
  binary: InsertDriveFileOutlinedIcon,
};
