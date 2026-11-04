# Stale dependencies audit (2026-11-04)

Scope: every direct dependency in the root and workspace `package.json` files on `licht`
(`@types/*` skipped, workspace packages skipped). "Stale" = latest release on npm is older
than 2024-11-04. File counts are files that import or reference the package (outside
`package.json` and lockfiles).

34 packages are stale. Two of them (`@foxglove/studio`, `@foxglove/fox`) only appear in the
e2e fixture extension's `package.json`, which is not a workspace and is never installed, so
they need no action.

## 1. react-dnd (biggest risk)

`react-dnd` 16.0.1 and `react-dnd-html5-backend` 16.0.1 (last release 2022-06). We carry
`patches/react-dnd.patch` for two things:

- React 19: `cloneWithRef` reads `element.ref`; React 19 moved it to `element.props.ref`.
- A drag source or drag preview that is disconnected and then reconnected (StrictMode, remounts)
  is never connected again.

Upstream will not fix either. This patch is also the only reason we still need patch-package
after the npm migration.

### Where it is used

| Area | Files |
| --- | --- |
| Providers (`DndProvider` + `HTML5Backend`) | `App.tsx`, `StudioApp.tsx`, `stories/PanelSetup.tsx` |
| Panel drag into the mosaic (shares `MosaicDragType.WINDOW` with mosaic) | `hooks/usePanelDrag.tsx`, `PanelCatalog/PanelListItem.tsx`, `EmptyPanelLayout.tsx`, `PanelLayout.tsx` |
| Settings tree reorder | `SettingsTreeEditor/NodeEditor.tsx` |
| Tab panel: reorder tabs, drop panels on tabs | `panels/Tab/DraggableToolbarTab.tsx`, `panels/Tab/TabbedToolbar.tsx` |
| Message path drag (topic list → panels) | `services/messagePathDragging/index.ts` |
| Tests and stories wrapping `DndProvider` | about 13 files |

That is 8 source files plus 3 providers. All of them are in `packages/suite-base`.

### react-mosaic-component pins us to react-dnd

`react-mosaic-component` (we use 6.2.0, latest 7.2.1 from 2026-09) is maintained, but **every
version, including 7.2.1, depends on `react-dnd` 16** (7.x adds `react-dnd-multi-backend` and
the touch backend on top). Upgrading mosaic does not get rid of react-dnd, and our patch
would still be needed. Mosaic is the heart of the layout: 25 files import its types or tree
helpers (`MosaicNode`, `getNodeAtPath`, `updateTree`, …), and saved layouts store `MosaicNode`
trees.

Mosaic is small: about 1.7k lines compiled, Apache-2.0. Only 4 of its files touch react-dnd
(`Mosaic`, `MosaicWindow`, `MosaicDropTarget`, `RootDropTargets`). The tree utilities are
plain functions.

### Options

| Option | Status | Fit |
| --- | --- | --- |
| `@atlaskit/pragmatic-drag-and-drop` 4.0.0 (2026-09) | Maintained by Atlassian, ~4 kB core, no React provider | Built on native HTML5 DnD, the same as our current `HTML5Backend`, so drag between windows and drops on native targets keep working. Adapters for elements and external data. **Recommended.** |
| `@dnd-kit/react` 0.5.3 (2026-10) | Active, but still 0.x | Pointer-event based, not native DnD. Changes drag behaviour and the API is still moving. |
| `@dnd-kit/core` 6.3.1 (2024-12) | Close to stale itself | No. |
| Native HTML5 DnD by hand | No dependency | Fine for the tab and settings-tree reorder, but we would rebuild edge detection, auto-scroll and drop indicators that pragmatic already provides. |
| Swap mosaic for `dockview` 8.8 / `flexlayout-react` 0.11 | Maintained, React 19, own DnD | Gives floating groups, popouts and tabs, but uses a different layout model. Every saved layout, the Tab panel and the panel toolbar actions would need migrating. That is a product decision measured in weeks, not dependency hygiene. |

### Recommendation

Vendor mosaic and move all drag and drop to `@atlaskit/pragmatic-drag-and-drop`, in two PRs:

1. **Vendor mosaic** into `packages/suite-base/src/components/mosaic` (TypeScript source from
   upstream 6.2.0, Apache-2.0 header kept). Drop the parts we don't use (zero state, default
   toolbar buttons, the multi-backend). It still uses react-dnd at this step, so behaviour stays
   the same. Removes `react-mosaic-component`. The layout format does not change.
2. **Swap the DnD library** in the 4 vendored mosaic files and our 8 source files at once.
   Panel drags share the mosaic drag type, so the two sides can't move separately. Delete the
   `DndProvider`s, `react-dnd`, `react-dnd-html5-backend`, the patch and patch-package.

Size: roughly 2–3 days. The diff is about +1.5k lines (vendored mosaic) and ±600 lines of DnD
rewrites. Tests to update: `PanelLayout.test`, `NodeEditor.test`, `SettingsTreeEditor/index.test`,
`Sidebars/index.test`, `StudioApp.test`, plus the story decorators.

Manual checks: drag a panel from the catalog onto every edge, drag a panel by its toolbar,
drop a panel into an empty layout, drag panels between tabs and reorder tabs, reorder the
settings tree, and drag a message path from the topic list onto a plot.

## 2. Easy wins (drop now, <1 hour each)

| Package | Last release | Files | What it does | Suggestion |
| --- | --- | --- | --- | --- |
| `eslint-plugin-filenames` | 2018-06 | 0 (8 stale disable comments) | Nothing: not registered in `eslint.config.mjs` | **Drop** and remove the `filenames/match-exported` disable comments |
| `eslint-plugin-es` | 2020-11 | 0 | Nothing: not registered | **Drop** |
| `electron-squirrel-startup` | 2024-05 | 1 (`suite-desktop/src/main/index.ts`) | Handles Squirrel.Windows install events | **Drop.** Our Windows target is NSIS only, so the check is always false |
| `ts-key-enum` | 2024-08 | 1 (`ThreeDeeRender/Input.ts`) | Enum of `KeyboardEvent.key` strings | **Drop**, use string literals (`"Escape"`) |
| `assert` | 2023-09 | 2 browser files + 1 CI script | Browser polyfill for node `assert` | **Drop.** The CI script gets `node:assert`; the 2 browser files use a plain `if (!x) throw new Error(...)`. The `assert: false` fallback in `webpack.ts` then goes too |
| `ts-node` | 2023-12 | 7 scripts, 2 workflows, 1 launch config | Runs CI and release `.ts` scripts | **Replace with plain `node file.ts`.** Node 26 strips types natively; check each script for enums or parameter properties (not supported by type stripping) |
| `style-loader` | 2024-04 | 1 (`suite-base/webpack.ts`) | Injects CSS | **Replace with Rspack native CSS** (`type: "css/auto"`). `css-loader` can go too. Check that the mosaic and Monaco CSS still apply in the right order |

## 3. Replace with a maintained package (small, worth doing)

| Package | Last release | Files | What it does | Suggestion |
| --- | --- | --- | --- | --- |
| `license-checker` | 2019-01 | 1 (`ci/license-check.ts`) | License allow-list check in CI | `license-checker-rseidelsohn` 5.0.1 (2026-05), same API |
| `depcheck` | 2023-10 | 1 (`ci/lint-dependencies.ts`) | Finds unused or missing deps | `knip` 6.44 (2026-10). It also covers unused exports, so it can replace `ts-unused-exports` and `ci/lint-unused-exports.ts` in one step |
| `nearley` + `nearley-loader` | 2020-12 / 2018-03 | 5 + 1 | Message path grammar parser | Works and the grammar is stable. If we want to move: `peggy` 5.1 (2026-10). Low priority |
| `tinycolor2` | 2023-02 | 25 | Color parsing and manipulation | `colord` 2.10 (2026-08) has the same feature set and is smaller. Mechanical but touches 25 files. Medium priority |
| `utif` | 2019-06 | 1 (desktop `rosPackageResources.ts`) | Decode TIFF `package://` textures to PNG | Works. `utif2` is a fork but itself from 2023. Keep |

## 4. Keep (finished, small, no known issues)

| Package | Last release | Files | What it does |
| --- | --- | --- | --- |
| `memoize-weak` | 2017-10 | 12 | WeakMap memoization with mixed object and primitive keys. Could become a ~30-line in-repo helper if it ever breaks |
| `intervals-fn` | 2018-06 | 5 | Interval set math for buffered ranges |
| `path-browserify` | 2020-03 | 2 (Rspack fallbacks) | `path` in the browser |
| `react-transition-group` | 2022-08 | 2 | Panel fullscreen transition. Already uses `nodeRef`, so React 19 is fine. Could become a CSS transition later |
| `fzf` | 2023-04 | 9 | Fuzzy search in pickers |
| `async-mutex` | 2024-03 | 5 | Async mutex |
| `rehype-raw` | 2023-08 | 1 | Raw HTML in markdown; unified ecosystem, stable |
| `@svgr/webpack` | 2023-08 | 1 | SVG → React components; works with Rspack |
| `pngjs` | 2023-02 | 1 | PNG encode on desktop |
| `chartjs-plugin-datalabels` | 2022-12 | 2 | Official Chart.js plugin, works with Chart.js 4 |
| `chartjs-plugin-annotation` | 2024-10 | 6 | Official Chart.js plugin, works with Chart.js 4 |
| `quicklookjs` | 2024-04 | 3 | macOS Quick Look preview extension |
| `@foxglove/wasm-zstd`, `@foxglove/wasm-lz4` | 2023 | 3 | WASM decompressors for MCAP and bag files |
| `@foxglove/electron-socket` | 2023-03 | 4 | TCP/UDP sockets for ROS 1 and Velodyne on desktop |
| `@foxglove/velodyne-cloud` | 2022-03 | 2 | Velodyne packet decoding |
| `@foxglove/avl`, `@foxglove/crc` | 2021 / 2024 | 1 each | AVL tree, CRC32 |

The `@foxglove/*` packages are finished building blocks. If one breaks, vendor it.
`wasm-zstd` is the only one on a hot path; see the MCAP performance notes before replacing it.

## Not stale but worth a note

- `@opentelemetry/sdk-trace-web` 2.12.0 is marked **deprecated** on npm. Check its replacement
  separately.
