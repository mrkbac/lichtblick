// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import DOMPurify from "dompurify";

import { ALLOWED_TAGS } from "@lichtblick/suite-base/panels/DiagnosticStatus/constants";

export function sanitize(value: string): { __html: string } {
  return {
    __html: DOMPurify.sanitize(value, {
      ALLOWED_TAGS,
      // font color/size and table colspan
      ALLOWED_ATTR: ["color", "size", "colspan"],
    }),
  };
}
