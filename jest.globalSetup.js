// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Run unit tests in UTC so time formatting and parsing don't depend on the machine's timezone.
module.exports = () => {
  process.env.TZ = "UTC";
};
