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
- Unit tests: `pnpm test` (whole repo; with parallel sessions use targeted runs, see Parallel Sessions)
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
- `chrome-extension/`: Chrome extension that lets https://licht.marko.im connect to plain `ws://` servers (mixed-content proxy)

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
- Don't patch dependencies (`pnpm patch`, `patchedDependencies`, editing `node_modules`). Work around the issue in our code, upgrade the dependency, or fix it upstream. Patch only as a last resort, and only with the user's approval.

## Product Goal

- Every panel must be good enough that people open Lichtblick just for that one panel. Don't settle for "works"; aim for best-in-class.
- Panels never hardcode topic names. A sensible default (e.g. `/tf`, `/tf_static`, or auto-detecting by schema) is fine, but users must be able to change which topics a panel reads in its settings, and any behavior tied to a topic (e.g. "static") must be a per-topic setting, not a name check.
- For inspiration, look at how Foxglove does it and at [pymcap-cli](https://github.com/mrkbac/pymcap-cli) (recording inspection/stats ideas). Borrow ideas, not code or branding.

## Fork Workflow (mrkbac/lichtblick)

- `licht` is the default branch, deployed to https://licht.marko.im. `develop` only mirrors upstream: never commit on it and never base new work on it.
- New work: branch from `origin/licht`, named `feature/…` or `bugfix/…`, in its own worktree so other work isn't touched.
- Every branch gets one PR into `licht`, ready for review (not draft): `gh pr create -R mrkbac/lichtblick --base licht`. Title = what the change does as a conventional commit (e.g. `feat(ws): support playbackControl`), not the latest commit subject.
- Don't push features or fixes directly to `licht`. Tiny fork-only config tweaks (deploy config) may go direct.
- No upstream PRs or merges unless the user asks.
- Before merging: typecheck and `build:packages` through the lock (see Parallel Sessions; CI runs `build:packages`, and unlike `typecheck` it also checks test files), targeted Vitest tests, and `pnpm exec oxlint --report-unused-disable-directives --max-warnings 0 --no-error-on-unmatched-pattern <changed files>` (same flags as CI's `pnpm lint:ci`). Merge with `gh pr merge --merge` (merge commit) and delete the branch.
- Every pushed branch gets a Cloudflare Pages preview at `<branch>.lichtblick-2pl.pages.dev` (`/` in the branch name becomes `-`, e.g. `feature-foo`); merging into `licht` deploys licht.marko.im.

### Parallel Sessions

Several agent sessions often run at once on one machine and share its RAM. `typecheck` and `build:packages` build one project at a time (`--builders 1`, ~4 GB peak instead of ~10 GB), and Vitest runs at most 4 workers (~2.5 GB instead of 6+ GB).

- Run typecheck through the lock shared by all worktrees, both steps in one call: `lockf "$(git rev-parse --git-common-dir)/heavy.lock" sh -c 'pnpm typecheck && pnpm build:packages'`
- Tests: targeted paths only (`pnpm exec vitest run <paths>`), never watch mode.
- Leave no dev servers, watchers or background jobs running after your turn.

### CodeRabbit

CodeRabbit reviews every push to a non-draft PR into `licht`, capped at 10 reviews/hour across all sessions. Push only ready work and batch fixes into one push. Fix every finding or answer it with a reason, and resolve each thread before merging.

### Never Leak Private Data

This repo is public. Nothing public (PRs, issues, comments, commit messages, code, tests, fixtures, images/screenshots/thumbnails) may contain company or customer names, machine names, recording/file names, topic names or topic structures, message values or schemas from real data, internal hostnames, IP addresses, URLs, or internal tooling details. Use generic placeholders (`ws://localhost:8765`, `example.mcap`). Scan the diff and PR text before pushing or opening a PR.

Panel thumbnails (`thumbnail.png`, 280x200) must be abstract like the stock ones: black background, text drawn as gray/colored bars, no readable topics or values, never a screenshot of real data.

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
