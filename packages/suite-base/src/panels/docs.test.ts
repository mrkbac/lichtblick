// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { getBuiltin } from "./index";

const t = ((key: string) => key) as unknown as TFunction<"panels">;

describe("built-in panel docs", () => {
  it.each(getBuiltin(t).map((info) => [info.type, info] as const))(
    "%s has docs with a short intro",
    async (_type, info) => {
      expect(info.docs).toBeDefined();
      const docs = (await info.docs!()).default;
      expect(docs.intro.length).toBeGreaterThan(0);
      expect(docs.intro.length).toBeLessThan(140);
    },
  );
});
