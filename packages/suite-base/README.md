# @lichtblick/suite-base

Core components and logic shared by the web and desktop apps.

## Quick start

You can import from `@lichtblick/suite-base` at its top-level or from lower in its directory:

```plain
import { ExtensionInfo, ExtensionLoaderContext, IExtensionLoader } from "@lichtblick/suite-base";
import { toError } from "@lichtblick/suite-base/util/toError";
```

For a full list of the package's exports, see [`src/index.ts`](src/index.ts).

## Telemetry

`@lichtblick/suite-base` includes an OpenTelemetry-backed implementation of the app's
`IAnalytics` abstraction (see [`services/telemetry/`](src/services/telemetry)), wired in via
[`AnalyticsProvider`](src/providers/AnalyticsProvider.tsx), and a generic
[`useInteractionCapture`](src/hooks/useInteractionCapture.ts) hook for wiring new UI click
sources into it without hand-writing a `logEvent()` call at every handler. See the root
repository README's Telemetry section for the user-facing opt-in model and privacy details.
