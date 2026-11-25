# Changelog

Highlights from Digitalis, a fork of Lichtblick. Dates follow when changes reached the `licht` branch, in Europe/Berlin time.

## 2026-11-24

- Hosted catalogs can include GPS tracks. Search the catalog map by area and highlight a recording’s route before opening it. [#562](https://github.com/mrkbac/lichtblick/pull/562)
- Hosted catalogs can include camera preview clips. Watch a thumbnail in the list or grid, then scrub any available camera clip in the recording details. On the HTTPS site, preview frames on non-loopback HTTP servers are still blocked. [#562](https://github.com/mrkbac/lichtblick/pull/562)
- The Digitalis Chrome proxy extension lets the HTTPS viewer open catalogs, thumbnails, layouts, and remote MCAP or ROS bag files from plain HTTP servers. The server must allow cross-origin reads. [#560](https://github.com/mrkbac/lichtblick/pull/560)
- Navigate the 3D view with a trackpad. Pan with two fingers, orbit with Alt/Option and two fingers, and pinch to zoom. [#551](https://github.com/mrkbac/lichtblick/pull/551)
- Hover over the playback timeline to preview compressed video. The thumbnail shows the nearest keyframe at or before the hovered time. [#536](https://github.com/mrkbac/lichtblick/pull/536)
- Switch the Topics sidebar to a collapsible namespace tree. Searching expands matching branches and shows the matching topics in context. [#537](https://github.com/mrkbac/lichtblick/pull/537)
- Pause playback immediately while a remote read is pending, and search topics while the recording buffers. [#535](https://github.com/mrkbac/lichtblick/pull/535)
- Camera drags over a sparse point cloud at point size 5 improved from **77–96 to 118–120 fps** in a Chrome production build on a 120 Hz MacBook. [#550](https://github.com/mrkbac/lichtblick/pull/550)
- Hidden tabs keep their panel state while the browser skips layout and painting for their contents. On the default Boreas layout at 1× playback in Chrome on a 120 Hz display, median frame time fell from **15 to 9.7 ms**. [#555](https://github.com/mrkbac/lichtblick/pull/555)
- The optional app-bar performance display shows frames per second, the longest frame in the last second, and JavaScript heap usage where available. [#553](https://github.com/mrkbac/lichtblick/pull/553)
- Editing the same layout in two browser tabs now preserves undo history from both tabs. [#546](https://github.com/mrkbac/lichtblick/pull/546)
- Teleop can stamp Joy and TwistStamped messages with data-source time for robots running on a simulation clock. [#544](https://github.com/mrkbac/lichtblick/pull/544)
- After a seek, the 3D panel can recover dynamic transforms whose last update was more than 128 seconds earlier. [#544](https://github.com/mrkbac/lichtblick/pull/544)

## 2026-11-23

- Scrolling over Plot now pans the chart. Pinch or hold Ctrl/Cmd while scrolling to zoom around the cursor. [#534](https://github.com/mrkbac/lichtblick/pull/534)
- Opening a layout link preserves same-named personal and shared layouts. Subsequent link installs can still replace the copy previously installed from a link. [#524](https://github.com/mrkbac/lichtblick/pull/524)
- Teleop and Publish restore their publishers after a Foxglove WebSocket reconnect. Pending service calls now report a closed connection when the link drops. [#530](https://github.com/mrkbac/lichtblick/pull/530)
- The desktop app validates paths when installing extensions and restricts which URLs it opens externally. [#531](https://github.com/mrkbac/lichtblick/pull/531)
- The web and desktop apps are now named **Digitalis**, with a new logo and icons. [#424](https://github.com/mrkbac/lichtblick/pull/424)
- Connect the web viewer to a Foxglove bridge over Tailscale. Sign in, select a peer, and open the connection through the browser’s WireGuard tunnel. [#423](https://github.com/mrkbac/lichtblick/pull/423)
- Color LiDAR points from a calibrated camera image. Scan trails retain their sampled colors, and you can switch cameras while paused. [#443](https://github.com/mrkbac/lichtblick/pull/443)
- Save multiple local and hosted recording catalogs. Browse their timelines, devices, datasets, and events, including sessions and episodes when the catalog provides them. [#469](https://github.com/mrkbac/lichtblick/pull/469)
- Playback follows the display refresh rate by default. In a Chrome development build on a 120 Hz MacBook, the Boreas sample went from **59.2 to 120 player updates/s**. [#508](https://github.com/mrkbac/lichtblick/pull/508)
- The Playback Performance panel distinguishes display frame rate from player updates and shows per-topic data rates, memory use, and main-thread delays. [#505](https://github.com/mrkbac/lichtblick/pull/505)
- State Transitions retains up to one million live samples per path. Downsampling one million alternating transitions for a 30-second view fell from **15.7 ms to 0.14 ms** in the panel benchmark. [#475](https://github.com/mrkbac/lichtblick/pull/475)
- The playback bar highlights the visible time range of the focused Plot or State Transitions panel. [#467](https://github.com/mrkbac/lichtblick/pull/467)
- Browse topics by namespace in panel settings and toggle visibility for a whole branch. [#468](https://github.com/mrkbac/lichtblick/pull/468)
- Raw Messages stacks old and new values and aligns their decimal points when comparing messages. [#506](https://github.com/mrkbac/lichtblick/pull/506)
- The desktop package no longer includes the macOS Quick Look extension. [#470](https://github.com/mrkbac/lichtblick/pull/470)

## 2026-11-22

- Removing a Plot series preserves the history of the others. Derived live values carry an approximation warning when recalculated from thinned data. [#453](https://github.com/mrkbac/lichtblick/pull/453)
- Imported layouts require approval before their scripts can run, including older JSON exports. The approval requirement travels with exported and synchronized layouts. [#451](https://github.com/mrkbac/lichtblick/pull/451)
- The web app loads players and infrequently used controls on demand, cutting cold-start JavaScript by **226.5 kB**. [#430](https://github.com/mrkbac/lichtblick/pull/430)
- Choose local files, URLs, catalog entries, samples, or recent MCAPs directly in the comparison picker. Mix local and remote recordings in one comparison. [#400](https://github.com/mrkbac/lichtblick/pull/400)
- Export a clip from a single remote MCAP and filter the topic list with a regular expression. [#397](https://github.com/mrkbac/lichtblick/pull/397)
- Copy a link that reopens a URL-backed recording at the current timestamp with the current layout. Shared remote comparisons also restore the recordings on each side and their time offsets. [#402](https://github.com/mrkbac/lichtblick/pull/402) · [#454](https://github.com/mrkbac/lichtblick/pull/454)
- See each topic’s share of recorded bytes and inspect its largest gaps in Data Source Info. [#396](https://github.com/mrkbac/lichtblick/pull/396)
- Read MCAPs without a usable index on demand, including unchunked recordings. Report conflicting records found during the scan. [#357](https://github.com/mrkbac/lichtblick/pull/357)
- Fetch a remote chunk and its message indexes together, and backfill topics in parallel. In the 44-topic benchmark at 50 ms network latency, median total seek time fell from **4.96 s to 3.64 s**. [#398](https://github.com/mrkbac/lichtblick/pull/398)
- Read ROS 2 SQLite bags in larger blocks and restore the latest value for each subscribed topic on seek, so panels can populate immediately. [#385](https://github.com/mrkbac/lichtblick/pull/385)
- Read only the requested ULog topics and restore values on seek. On a synthetic 500 MB PX4 log, memory after opening fell from **1,224 MB to 231 MB**. [#386](https://github.com/mrkbac/lichtblick/pull/386)
- Seek within live history without walking the entire buffer. If the receive queue overflows, preserve the latest message per topic and the latest transform per frame. [#351](https://github.com/mrkbac/lichtblick/pull/351)
- Preload around the playhead when the recording exceeds the cache budget, evicting the farthest data first. [#390](https://github.com/mrkbac/lichtblick/pull/390)
- Explain why a transform lookup failed, including whether a frame is unknown or the two frames belong to separate trees. [#395](https://github.com/mrkbac/lichtblick/pull/395)
- Keep point-cloud and laser-scan trails across the full decay window when memory is tight, and rebuild that window immediately after a seek. [#353](https://github.com/mrkbac/lichtblick/pull/353) · [#358](https://github.com/mrkbac/lichtblick/pull/358)
- Retain long GPS tracks in compact columns and draw only the detail needed at the current map scale. On a synthetic 720,000-fix track, the generated GeoJSON shrank from **271 MB to 10 MB**. [#363](https://github.com/mrkbac/lichtblick/pull/363)
- Add or edit a Plot series directly in the legend. [#381](https://github.com/mrkbac/lichtblick/pull/381)
- Inspect long arrays in Raw Messages by index range. Collapsed arrays show a summary without enumerating millions of elements. [#375](https://github.com/mrkbac/lichtblick/pull/375) · [#377](https://github.com/mrkbac/lichtblick/pull/377)
- Measure only visible log rows as the playhead moves and share repeated node and file names in memory. In headless Chromium with two million synthetic log lines, playback improved from **9.3 to 60.2 fps**. [#376](https://github.com/mrkbac/lichtblick/pull/376) · [#378](https://github.com/mrkbac/lichtblick/pull/378)
- Open a topic or field in a compatible panel from its context menu. The Add panel picker also suggests panels that match the open data. [#380](https://github.com/mrkbac/lichtblick/pull/380) · [#382](https://github.com/mrkbac/lichtblick/pull/382)
- Update one browser window without interrupting the others, then resume the workspace where it was. [#366](https://github.com/mrkbac/lichtblick/pull/366)
- Open attachments from recovered local MCAPs, including incomplete files without a final summary. [#410](https://github.com/mrkbac/lichtblick/pull/410)
- Seeking backward now looks up recorded poses without replaying earlier transforms. On a synthetic 10-minute recording with 2.4 million transforms, retaining the full transform history used **147 MB**, down from **1,171 MB** with the previous cap raised to cover the same run. [#348](https://github.com/mrkbac/lichtblick/pull/348)

## 2026-11-21

- The 3D panel now requires WebGPU on web and desktop. It reports when the device cannot provide it.
- Orbiting a synthetic scene with **30 million accumulated points** went from **13 to 112 fps** in Chrome on an M4 Max at 2958 × 1610. Point clouds, laser scans, and depth clouds use the new compute renderer. [#344](https://github.com/mrkbac/lichtblick/pull/344)

## 2026-11-20

- **Sample recordings.** Browse public datasets from the start screen or open a recording catalog by URL.
- **MCAP attachments.** Preview and download attachments from indexed local recordings. Images, video, audio, PDFs, and text have previews. Unknown binary files open in a hex view.
- **3D measurements.** Measurements stay anchored in world coordinates when the camera moves. Elevation profiles sample vertically beneath the selected line.
- Switching layouts keeps panels mounted so returning to a layout can reuse its panel state.
- Filter the log drawer by debug, info, warning, or error. Missing topics and malformed transforms now report different severities.

## 2026-11-18

- Display volumetric occupancy grids from ROS/Nav2 and Foxglove in the 3D panel.
- **Draco point clouds.** A built-in converter unpacks compressed positions, colors, and named attributes for point-cloud consumers.
- **Odometry.** Display ROS and Foxglove odometry as a pose with its position covariance ellipsoid.
- **Robot models.** Foxglove joint-state messages can drive articulated models alongside the existing ROS joint-state support.
- The Audio panel gained support for Foxglove compressed-audio messages.

## 2026-11-17

- Synchronize selected 3D layers by exact timestamp. Other layers can keep updating while the viewer waits for a matching set.
- Project a camera image onto a plane in a chosen frame.
- Turn calibrated depth images into 3D point clouds, optionally colored by a second camera.
- **Terrain.** Display GridMap messages in 3D. Grid layers can use a numeric field for elevation, with slope lighting, selectable interpolation, and visible cell borders.
- Adjust model opacity, show axes, inspect individual links, and drive the model from joint states.
- **Stack panel.** Arrange child panels in a row, column, or grid within an existing layout.
- Browse the saved undo history and click an earlier edit to restore that layout state.
- **MCAP compatibility.** Read valid chunks that omit per-message indexes by scanning their records and caching the result.
- **Boreas sample.** The default example opens a synchronized camera, LiDAR, radar, GPS, and IMU recording with a prepared layout.

## 2026-11-16

- Render Cloudini-compressed point clouds directly in the 3D panel.
- Open MessagePack and CBOR channels in MCAP, with or without a JSON schema. Message paths preserve 64-bit integers and byte arrays.
- Read Cap’n Proto channels from their embedded MCAP schemas, including unions and multi-segment messages.
- **ROS 2 QoS.** Data Source Info shows the policies offered on each recorded topic.
- **Foxglove extensions.** Load extensions built against the supported stable Foxglove API, including topic converters. The public Lichtblick extension API is checked against its pinned upstream version.
- **Command palette.** Add a panel by name or alias, search message paths, and act on a selected result from the keyboard.
- **Panel guide.** Open searchable, in-app help for a panel’s buttons and settings directly from its settings header.
- **Offline startup.** The installed web app caches its build files, including features loaded on demand. Large 3D and archive libraries stay off the initial startup path.

## 2026-11-15

- **Compare recordings.** Build each side from one or more local files, add common files to every side, and change the selection from the data-source sidebar.
- Remote MCAPs take fewer HTTP round trips to open. With 80 ms of simulated latency per request, a 112 MB file initialized in **175 ms, down from 340 ms**. A bundle of 60 × 33 MB files went from **4.98 s to 0.74 s**. [#246](https://github.com/mrkbac/lichtblick/pull/246)
- Two workers decompress MCAP chunks in parallel. In Chrome, the reader scanned a 1.1 GB Zstandard recording in **0.87 s, down from 2.74 s**. Median seek time on that file fell from **30 to 12 ms**. [#253](https://github.com/mrkbac/lichtblick/pull/253)
- Compile a CDR decoder once per schema. Decoding 31,000 marker-heavy messages from the public nuScenes sample took **75 ms**, down from **592 ms** with the preceding ES2022 reader. [#241](https://github.com/mrkbac/lichtblick/pull/241)

## 2026-11-14

- **Multi-run comparison.** Open several MCAP runs in your own layout, offset them independently, and overlay corresponding signals on one plot.
- **CSV and TSV.** Open delimited files as topics with typed fields. The reader recognizes timestamp columns and units, merges multiple files in time order, and falls back to one-second row spacing when there is no usable timestamp.
- **Multi-file MCAP recovery.** Begin playback while individual files are still being indexed. As more data becomes available, the player updates the affected range.
- **Corrupt chunks.** A decompression failure discovered during playback can be isolated to one chunk. The reader continues with readable data without restarting a whole-file scan.
- **Video seeking.** Find the keyframe and following frames in a forward read, reducing worker round trips when seeking into compressed video.
- **Model textures.** Local meshes with TIFF textures now render in both the web and desktop apps.

## 2026-11-13

- **Growing MCAPs.** Open a single local recording through a file handle and follow newly appended messages. Playback follows growth at the end and respects your position if you scrub back.

## 2026-11-12

- Open a truncated MCAP and start playback while its index rebuilds. On a 1.1 GB Zstandard recording cut off at 90%, peak process memory fell from **3.4–4.3 GB to 0.5 GB**. A full read took longer, **2.6–3.2 s** versus **1.7–1.9 s**. [Progressive playback](https://github.com/mrkbac/lichtblick/pull/221) · [#218](https://github.com/mrkbac/lichtblick/pull/218)
- **Recovered indexes.** Store rebuilt indexes in browser storage so reopening a recording can reuse the recovery work.
- Register the Lichtblick URL scheme and optionally open Foxglove links in the desktop app.

## 2026-11-11

- Grant read access to a local workspace so the web viewer can resolve package resources during playback.
- **Local model assets.** Open meshes with their accompanying materials and textures in the 3D view.
- Load an unpacked extension folder in the web app and refresh it after editing.
- **Installed web app.** Launch the PWA from supported custom protocol links.

## 2026-11-10

- Building one package at a time cut peak memory for a cold package build from **about 10 GB to 4.1 GB**. Build time on the test machine went from **11.8 to 12.7 s**. [#213](https://github.com/mrkbac/lichtblick/pull/213)

## 2026-11-08

- Move a panel into another browser window or keep it visible in Picture-in-Picture.
- **Monitor workspaces.** Save and restore a multi-window arrangement for a layout.
- **Split tabs.** Stacking panels creates a Tab panel whose contents can themselves be split or nested.
- **Recording catalog.** Browse saved live sessions in list, grid, or map view, preview their camera and GPS data, and filter them by source machine.
- **3D maps.** MapLibre draws the map directly in the 3D scene. Fixes without a frame now anchor correctly.
- **Attitude gauges.** Show roll or pitch as an inclinometer.
- Edit Markdown directly in the panel with live styling.

## 2026-11-07

- **Live MCAP recording.** Record subscribed Foxglove WebSocket traffic to browser storage. A disk budget rotates older recordings as new ones arrive.
- **History download.** Save a snapshot of the current live buffer as MCAP, including retained values for infrequently published topics.
- **Saved sessions.** Reopen recordings from the start screen and identify which machine supplied each session.
- **Live plots.** Hold the Y range steady as the time window slides. The legend reports the plotted value for averaged or derived series, and timestamps can be displayed relative to now.
- **Watch.** Expand a message as a field tree, pull a nested field into its own row, or plot all fields beneath a selected message.

## 2026-11-06

- **Live rewind.** Pause a Foxglove WebSocket stream, scrub through recent subscribed messages, and return to live while reception continues. Set both a history duration and a memory budget.
- **Plain WebSocket connections.** An optional Chrome extension lets the hosted HTTPS viewer connect to a reachable robot serving plain WebSocket.
- **Frequency analysis.** Switch Plot to an FFT spectrum to find dominant frequencies, or use a histogram to inspect the distribution of sampled values.
- Save a chart as PNG, export only the visible time interval as CSV, or copy all series values at the cursor for a spreadsheet.
- Redrawing ten receive-time series with a million points each took **47 ms, down from 255 ms**, in the plot benchmark. Retained memory fell from **2,106 MB to 414 MB**. [#88](https://github.com/mrkbac/lichtblick/pull/88)
- **Frame measurement.** Pick two frames in 3D or Transform Tree to read their relative translation, distance, and rotation. Both panels share the selection.
- **Manual calibration.** Edit a frame offset or its resulting pose and nudge it in fine increments. The transform adjustment carries across the 3D and Image views.
- **Camera Grid.** Play compressed video, overlay image annotations, and link pan and zoom across cameras.
- **Video codecs.** Added AV1 and VP9 playback for compressed-video messages.
- **Raw and depth images.** Decode NV12, NV21, and planar YUV420 images, plus PNG- and RVL-compressed ROS depth images.
- **Audio.** A dedicated panel plays recorded audio and displays its waveform.
- **Teleop.** Combine keyboard, gamepad, and on-screen controls. Publish raw Joy messages or velocity commands, with configurable axes and stop controls.
- **Layout templates.** Starter layouts choose compatible topics by schema when a recording opens.
- **Layout editing.** Undo or redo changes and reopen a closed panel. Split junctions can be dragged in two dimensions.

## 2026-11-05

- **3D measurement tools.** Pick points to measure distance, angle, area, or height. Trace a path for segment lengths or an elevation profile.
- **Timeline preview.** Hover over the playback bar to see a camera thumbnail before seeking.
- **State Transitions.** Enter a condition and step between the intervals where it matches.
- **Watch panel.** Monitor several message paths in one table, with units, precision, and a sparkline for each field.

## 2026-11-04

- **MCAP clip export.** Mark a time range, select or rename topics, keep every Nth message, and write a new recording with optional compression.
- **Camera Grid.** Display several camera feeds together in a single panel.
- **Topic Health.** Compare observed and expected rates, inspect time since the last message, and sort slow or stale topics to the top.
- **Log.** Search messages from multiple topics across a recording and seek from the severity timeline.
- **Diagnostics.** Inspect status history over time and combine diagnostic topics in one view.
- **Plot.** Pair two fields in an XY series, use a secondary Y axis, box-zoom into a region, and calculate statistics for a selected range.
- **Parameters.** Browse a searchable namespace tree, edit values with type-specific controls, and take parameter snapshots.
- **Publish and Call Service.** Compose structured messages with form controls, save presets, repeat a publication, and inspect service-call history.
- **Indicator.** Configure sounds and browser notifications when a value enters a rule’s matching range.
- **Notes panel.** Keep Markdown instructions, links, and clickable checklists with a layout.
- **Shared layouts.** Connect an organization API to sign in and share layouts with teams that have the appropriate permissions.
- **Command palette.** Open the palette with Ctrl/Cmd+K and find actions from the keyboard.

## 2026-11-03

- **Start page.** Open recent sources and browse a recording folder from one screen.
- **Catalog map.** Find a recording by where it was captured.
- Play a short looping clip in the catalog to identify a recording before opening it.

## 2026-11-02

- **Local recording catalog.** Pick a folder of MCAP files and search its recordings from inside the app.
- **Point clouds.** Draw points as 3D cubes.
- **Web startup.** Load large libraries for 3D, tables, and syntax highlighting on demand.

## 2026-11-01

- **Offline web app.** Install the viewer as a PWA. After a reload it can reopen the previous local file when permission is available.
- **Raw Messages.** Step to the previous or next message on a selected topic.
- **Transform Tree.** Inspect the frame hierarchy in a dedicated panel.
- The Map panel moved to MapLibre, and map layers can also be displayed in the 3D scene.
- **Teleop inputs.** Drive the panel with a joystick, keyboard, or gamepad.

## 2026-10-31

- **Recording inspection.** Examine byte counts, timing jitter, duplicate timestamps, and the longest interval between messages for each topic.
- **Remote playback control.** Play, pause, seek, and change speed on Foxglove WebSocket servers that advertise the capability.
- **Message paths.** Modifier autocomplete, typed results, and input validation make field expressions easier to enter and check.
