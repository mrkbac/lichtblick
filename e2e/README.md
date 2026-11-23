# End-to-End (E2E) Testing for Lichtblick

This directory contains all end-to-end (E2E) tests using [Playwright](https://playwright.dev/). They run against the web app.

## 📦 How to Run

```bash
# Install Playwright
pnpm exec playwright install
```

### Web

```bash
# Run all web tests
pnpm test:e2e:web

# Run in debug mode (step-by-step)
pnpm test:e2e:web:debug

# View latest web test report
pnpm test:e2e:web:report
```

### Summary

```bash
# Generate test summary with timings (after a run)
pnpm test:e2e:summary
```

## 🏷️ Test Categories

All E2E tests are labeled with one of two tags that control which CI pipeline executes them:

| Tag           | When it runs                                    | Criteria                                                                                        |
| ------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@smoke`      | Every PR / every push                           | Critical user-path tests: opening files, basic player controls, primary layout and menu actions |
| `@regression` | Nightly (02:00 UTC) + `develop` / `main` merges | Edge cases, keyboard shortcuts, extended scenarios, slower workflows (extensions, remote data)  |

### Run by category locally

```bash
# Smoke only
pnpm test:e2e:web:smoke

# All tests (smoke + regression)
pnpm test:e2e:web
```

---

## 📊 Test Performance Analysis

After running tests, you can generate a summary report showing test execution times:

```bash
# Run tests and generate summary
pnpm test:e2e:web
pnpm test:e2e:summary
```

The summary includes:

- **Overall statistics** (total tests, passed/failed/skipped)
- **Top 10 slowest tests** to identify performance bottlenecks
- **Failed tests list** with retry information
- **Total and average execution times**

This helps identify which tests are taking too long and may need optimization.

## 🧪 Filename Pattern

Test files follow the pattern:

```ts
{feature-name}.{platform}.spec.ts
```

**Example:**

```
install-multiple-extensions.web.spec.ts;
```

## 🗂 Directory Structure

```text
/e2e
  ├── tests/                         # E2E tests
  │   └── web/                       # Web e2e tests
  │       ├── open-files/            # Tests for open files via URL
  │       │   ├── open-mcap-via-url.web.spec.ts
  │       │   └── ...web.spec.ts
  │       ├── utils/                 # Shared functions
  │       ├── web-setup.ts           # Pre-script to setup web tests
  │       └── playwright.config.ts   # Web Playwright configuration
  ├── page-objects/                   # Page Object Models for UI abstraction
  │   ├── sidebar.ts                 # Left/right sidebar navigation
  │   ├── player-controls.ts         # Playback controls (play, pause, seek)
  │   ├── layout-manager.ts          # Layout creation and management
  │   └── index.ts                   # Barrel export
  ├── fixtures/                      # Fixtures for testing (e.g. data mocks)
  ├── reports/                       # Automatically generated test reports
  ├── global-setup.ts                # Global setup before testing
  └── global-teardown.ts             # Cleanup after testing (clear DB, stored files, etc.)
```

## Page Object Models (POMs)

Reusable UI abstractions live in `e2e/page-objects/`. They encapsulate common interactions so tests focus on behavior, not selectors.

### Available POMs

| POM                | Purpose                         | Key Methods                                                                                                            |
| ------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Sidebar`          | Left/right sidebar tabs         | `openLayoutsTab()`                                                                                                     |
| `PlayerControls`   | Playback controls               | `play()`, `getTimestampText()`, `getPlayButton()`, `getSlider()`, `getTimestampInput()`                                |
| `LayoutManager`    | Layout CRUD                     | `getCreateNewLayoutButton()`, `selectPanel()`                                                                          |

### Usage Example

```ts
import { test, expect } from "@playwright/test";

import { LayoutManager, Sidebar } from "../../page-objects";

test("create a new layout", async ({ page }) => {
  const sidebar = new Sidebar(page);
  const layout = new LayoutManager(page);

  // Given
  await page.goto("/");
  await sidebar.openLayoutsTab();

  // When
  await layout.getCreateNewLayoutButton().click();

  // Then
  await expect(page.getByText("Unnamed layout").nth(0)).toBeVisible();
});
```

### When to Use POMs vs Direct Selectors

- **Use POMs** for common, repeated interactions (navigating the sidebar, player controls, layouts)
- **Use direct selectors** for one-off, test-specific elements that don't appear across multiple tests

## Selector Priority Strategy

When choosing selectors for new tests, follow this priority order:

1. **`getByTestId()`** — `data-testid` attributes. Most stable and used extensively in this project.
2. **`getByRole()`** — Accessibility roles with ARIA names. Resilient to implementation changes.
3. **`getByText()` / `getByPlaceholder()`** — Visible text content. Good for user-facing labels.
4. **`locator()` with CSS** — Last resort, for elements without accessible roles or test IDs.

Avoid XPath selectors and MUI class names (e.g., `.MuiButton-root`).

---

> For questions or improvements, contact the Lichtblick team or refer to the [Playwright docs](https://playwright.dev/docs/intro).
