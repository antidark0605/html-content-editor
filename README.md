# HTML Content Editor

A small Windows desktop app for editing **visible text** in an existing HTML file without turning the job into a tour of `<div>`, `<span>`, and other archaeological layers.

The core rule is deliberately strict:

> Edit text. Preserve layout.

Instead of serializing the whole DOM back to HTML, the app tracks the original source offsets of visible text nodes and patches only the text you changed.

## MVP features

- Open `.html` / `.htm` files
- Click highlighted visible text and edit it directly
- Preserve existing tags, classes, inline styles, CSS, and surrounding markup
- Preview the modified HTML before saving in a read-only final-render view
- Review Editor changes with a navigable diff, previous/next controls, and an overview rail
- Undo / redo committed text edits
- Search visible editable text
- Save / Save As
- Create a one-time `*.hce-backup.html` before the first overwrite
- Side-by-side Compare workspace for two HTML files
- Visual Compare highlights changed visible text, including word-level changes
- Edit visible text directly on either Visual Compare pane; changes immediately become part of the comparison
- Source Compare aligns lines, highlights inline changes, and provides per-hunk left/right merge arrows
- Previous/next difference navigation plus a difference overview rail positioned from the actual diff locations
- Araxis-style ← / → merge controls shown beside each visible/source diff block instead of relying on a toolbar-level merge action
- Multi-level Compare Undo/Redo for merges and direct Visual Compare edits, including Ctrl+Z / Ctrl+Y and visible history depth
- Content-anchor synchronized scrolling in Visual Compare to keep related sections aligned without feedback bounce
- Swap, Reload, Save per side, and shared Zoom in Visual Compare
- App version is shown in the UI and Windows title
- About dialog shows version, build commit, runtime/platform information, project, issues, and MIT license links
- Drag a single `.html` / `.htm` file into Editor, Compare Left, or Compare Right to open it there
- Copy the full path of the current Editor/Compare file to the Windows clipboard
- Open-file dialogs remember the last useful directory, prefer the other Compare pane when appropriate, and safely fall back when a remembered/network path is unavailable
- Windows installer and portable executable built by GitHub Actions

## Safety model

HTML can contain executable JavaScript. Page scripts are intentionally **disabled** in Edit, Preview, and Compare mode. CSS, images, and normal HTML layout can still render.

This repository is public. Do not commit private/internal HTML samples, credentials, API keys, customer data, or proprietary material.

Windows builds are currently unsigned, so Microsoft SmartScreen may warn when launching a downloaded build. Code signing can be added later.

## About and drag & drop

The **About** dialog provides the current app version, build commit, Electron/Chrome/Node versions, Windows platform/architecture information, GitHub project and issue links, and the MIT license link. It intentionally does not collect telemetry or maintain a persistent diagnostics log.

You can drag one `.html` or `.htm` file at a time into the app:

- Editor workspace → open in Editor
- Compare workspace left target → open as Left
- Compare workspace right target → open as Right

Existing unsaved-change confirmation behavior is preserved. Each open file also has a **Copy path** action for copying its full filesystem path.

## Editor modes

- **Edit**: directly edit visible text. The app temporarily wraps editable text nodes with helper elements so they can receive focus.
- **Preview**: read-only final rendering of the current working HTML without those editing helpers. Use this as the authoritative layout check.
- **Diff**: compare the original file with the current working copy. The diff view provides previous/next navigation and a right-side overview rail whose markers map to the rendered difference positions.

## Open-directory behavior

The app remembers the most recently opened directory in Electron's per-user `userData/settings.json`. It does not blindly trust that path.

For Editor Open, the preference order is:

1. current Editor file directory
2. last remembered open directory
3. Documents
4. Home

For Compare Open, the other pane's directory is preferred first so opening the second file usually starts beside the first one.

Every candidate is checked before it is passed to the native Windows dialog. Missing, disconnected, or stalled network-drive paths are ignored and the app falls back to the next usable directory. Directory checks have a short timeout so an unavailable NAS/VPN mapping does not block opening the dialog.

## Compare two pages

Switch to **Compare**, then open a left and right HTML file.

### Visual

Visual Compare renders both pages and compares their visible text. Changed blocks are highlighted, with stronger word-level highlighting inside changed text. Previous/next difference controls jump between change blocks. Both panes are directly editable: click visible text, type, then blur or press Enter. The comparison recalculates immediately and the edited side becomes Unsaved.

Visual merge copies text only when the two change blocks have compatible text-node structure, so the target page keeps its existing tags, classes, and formatting. Each mergeable difference gets its own ← / → controls in the center gutter. Direct Visual edits and merge operations share the same multi-level Undo/Redo history. Structural insertions/deletions show disabled visual arrows and should be merged in Source view.

**Sync** uses matching text anchors from the diff to align related content rather than simply copying scrollbar percentages. Programmatic scrolling on the follower pane is suppressed from feeding back into the leader pane, avoiding the old oscillation/back-jump behavior.

### Source

Source Compare provides an Araxis/WinMerge/Meld-style aligned text view:

- line numbers on both sides
- changed lines highlighted
- changed words highlighted inside lines
- blank alignment rows where one side has extra lines
- per-change **← / →** merge buttons positioned in the center gutter at the actual diff block
- multi-level merge **Undo / Redo**
- previous / next difference navigation
- overview rail whose marker position reflects each diff's real document position
- Save button and unsaved indicator for each side

Source merge copies the selected source hunk exactly, so it can also handle HTML structure, attributes, CSS, and inserted/deleted lines. Source Compare remains intentionally read-only for direct typing; use Visual Compare for text editing and Source Compare for precise structural merge operations.

JavaScript remains disabled in Visual Compare. Relative CSS/images are resolved from each HTML file's own directory.

## Current limitations

The first version focuses on static HTML content. It intentionally does not edit text inside:

- `<script>`
- `<style>`
- `<noscript>`
- `<template>`
- `<title>`
- `<textarea>`
- `<option>`
- SVG / MathML / canvas content

Pages whose visible content is generated only by JavaScript will not expose that generated text for editing in v0.5.

The Edit view temporarily wraps editable text in helper spans, so a page with unusually strict CSS selectors may look slightly different while editing. **Preview does not contain those wrappers**, and is the authoritative layout check before saving.

## Run from source

```bash
npm install
npm start
```

## Test

Unit tests:

```bash
npm test
```

Real Electron UI validation:

```bash
npm run test:ui
```

The Windows CI runs unit tests and the Electron UI validation **before** packaging binaries. The UI test verifies the displayed version and About metadata, exercises Copy path using the real Electron clipboard, opens HTML through the drag-and-drop flow, edits both Visual Compare panes, checks Compare Undo/Redo, validates synchronized scrolling and diff-local merge controls, verifies Source rail positions, then switches to Editor, edits visible text, validates Edit/Preview behavior and Editor diff navigation/rail markers. CI also keeps validation screenshots as an artifact.

## Build for Windows

```bash
npm run build:win
```

GitHub Actions also builds both Windows targets automatically:

- `HTML-Content-Editor-Setup-<version>-x64.exe`
- `HTML-Content-Editor-Portable-<version>-x64.exe`

Download them from the **Windows Build** workflow artifact named `HTML-Content-Editor-Windows`.

## License

HTML Content Editor is released under the [MIT License](./LICENSE).

The application also uses third-party open-source components under their own licenses. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Binary distributions include Electron/Chromium components and their upstream notices.
