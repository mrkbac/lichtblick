# AGENTS.md

This file helps AI coding agents work effectively in the Lichtblick monorepo.

## Quick Start

- Use Node.js 26+.
- Install pnpm, then the dependencies (pnpm switches to the version pinned in `package.json`):

```sh
npm install --global pnpm
pnpm install
```

- Use pnpm commands only (not npm or Yarn).

## Core Commands

- Lint and auto-fix: `pnpm lint`
- CI lint mode: `pnpm lint:ci`
- Unit tests: `pnpm test`
- Coverage: `pnpm test:coverage`
- Type check (from contributing guide): `pnpm typecheck`
- Build internal packages: `pnpm build:packages`

Desktop app development (run in separate terminals):

```sh
pnpm desktop:serve
pnpm desktop:start
```

Web app development:

```sh
pnpm web:serve
```

E2E tests:

- Desktop: `pnpm test:e2e:desktop`
- Web: `pnpm test:e2e:web`

## Monorepo Map

- `desktop/`: Electron app entry points (`main/`, `preload/`, `renderer/`, `quicklook/`)
- `web/`: Web app bundling and entry point
- `packages/suite-base/`: Shared core UI and logic
- `packages/suite-desktop/`: Desktop-specific internal package
- `packages/suite-web/`: Web-specific internal package
- `packages/suite/`: Extension API types
- `e2e/`: Playwright end-to-end tests
- `ci/`: CI and repository maintenance scripts
- `patches/`: pnpm `patchedDependencies` patches for third-party dependencies

## High-Impact Conventions

- Follow TypeScript strict patterns; avoid `any` unless necessary.
- Prefer `undefined` over `null` (except where React APIs require otherwise).
- Use `tss-react/mui` patterns for styling instead of ad-hoc styling approaches.
- Keep component structure consistent with the contributing guide (`index.tsx`, component file, `types.ts`, `constants.ts`, `*.style.ts`, tests).
- New source files should include the MPL-2.0 license header used in this repo.
- If changing UI behavior, validate in both desktop and web modes when relevant.

## UI Consistency

- Keep new and updated UI consistent with Lichtblick's existing design language. Reuse existing components, MUI controls, `tss-react/mui` styles, and theme tokens for typography, colors, spacing, borders, and icons.
- Match the alignment, sizing, and information density of neighboring panels. Do not introduce separate branding or a bespoke visual style unless the user explicitly requests it.
- Preserve existing UI terminology and the selected interface language; use the project's localization patterns for new text.

## Testing Guidance

- Add or update tests with code changes.
- Prefer targeted test runs while iterating; run broader suites before finishing.
- Unit tests use Vitest and are typically colocated with source files (`*.test.ts` / `*.test.tsx`).
- E2E tests use Playwright and follow `{feature-name}.{platform}.spec.ts`.

## Agent Guardrails

- Do not edit generated outputs unless the task explicitly requires it:
  - `coverage/`
  - `storybook-static/`
  - `dist/`
  - `.webpack/`
  - `test-results/`
  - `e2e/reports/`
  - `e2e/tests/reports/desktop/`
  - `e2e/tests/reports/web/`
  - `e2e/tmp/`
- Keep dependency patch changes isolated to `patches/` and related dependency metadata.

## Reference Docs

- Main project guide: [README.md](README.md)
- Contributing and coding standards: [CONTRIBUTING.md](CONTRIBUTING.md)
- E2E testing details: [e2e/README.md](e2e/README.md)
- Package scripts and workspace configuration: [package.json](package.json)
- Package-specific notes:
  - [packages/suite-base/README.md](packages/suite-base/README.md)
  - [packages/suite-desktop/README.md](packages/suite-desktop/README.md)
  - [packages/suite-web/README.md](packages/suite-web/README.md)
  - [packages/suite/README.md](packages/suite/README.md)
