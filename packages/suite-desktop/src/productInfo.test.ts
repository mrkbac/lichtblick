// SPDX-License-Identifier: MPL-2.0

import { productInfo } from "@lichtblick/suite-base/rspack.ts";

describe("productInfo", () => {
  it("normalizes the docs and repository URLs from package.json", () => {
    expect(
      productInfo({
        productName: "Example",
        homepage: "https://example.com/manual",
        repository: { url: "git+https://example.com/org/repo.git" },
      }),
    ).toEqual({
      name: "Example",
      homepage: "https://example.com/manual/",
      repositoryUrl: "https://example.com/org/repo",
    });
  });

  it("keeps an existing trailing slash", () => {
    expect(
      productInfo({
        productName: "Example",
        homepage: "https://example.com/docs/",
        repository: { url: "https://example.com/org/repo" },
      }).homepage,
    ).toBe("https://example.com/docs/");
  });
});
