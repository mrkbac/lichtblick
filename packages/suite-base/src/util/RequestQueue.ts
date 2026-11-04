// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Semaphore } from "async-mutex";

import { GLOBAL_REQUEST_QUEUE_MAX_CONCURRENT } from "@lichtblick/suite-base/util/constants";

// Global concurrency limit for all HTTP requests
export const globalRequestQueue = new Semaphore(GLOBAL_REQUEST_QUEUE_MAX_CONCURRENT);
