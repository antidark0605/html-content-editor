# HTML Content Editor

A small Windows desktop app for editing **visible text** in an existing HTML file without turning the job into a tour of `<div>`, `<span>`, and other archaeological layers.

The core rule is deliberately strict:

> Edit text. Preserve layout.

Instead of serializing the whole DOM back to HTML, the app tracks the original source offsets of visible text nodes and patches only the text you changed.

## MVP features

- Open `.html` / `.htm` files
- Click highlighted visible text and edit it directly
- Preserve existing tags, classes, inline styles, CSS, and surrounding markup
- Preview the modified HTML before saving
- Review a line diff
- Undo / redo committed text edits
- Search visible editable text
- Save / Save As
- Create a one-time `*.hce-backup.html` before the first overwrite
- Side-by-side Compare workspace for two HTML files
- Visual Compare highlights changed visible text, including word-level changes
- Source Compare aligns lines, highlights inline changes, and provides per-hunk left/right merge arrows
- Previous/next difference navigation plus a difference overview rail positioned from the actual diff locations
- Araxis-style ← / → merge controls shown beside each visible/source diff block instead of relying on a toolbar-level merge action
- Multi-level Compare Undo/Redo for merge operations, including Ctrl+Z / Ctrl+Y and visible history depth
- Content-anchor synchronized scrolling in Visual Compare to keep related sections aligned without feedback bounce
- Swap, Reload, Save per side, and shared Zoom in Visual Compare
- Windows installer and portable executable built by GitHub Actions

## Safety model

HTML can contain executable JavaScript. Page scripts are intentionally **disabled** in Edit, Preview, and Compare mode. CSS, images, and normal HTML layout can still render.

This repository is public. Do not commit private/internal HTML samples, credentials, API keys, customer data, or proprietary material.

Windows builds are currently unsigned, so Microsoft SmartScreen may warn when launching a downloaded build. Code signing can be added later.

## Compare two pages

Switch to **Compare**, then open a left and right HTML file.

### Visual

Visual Compare renders both pages and compares their visible text. Changed blocks are highlighted, with stronger word-level highlighting inside changed text. Previous/next difference controls jump between change blocks.

Visual merge copies text only when the two change blocks have compatible text-node structure, so the target page keeps its existing tags, classes, and formatting. Each mergeable difference gets its own ← / → controls in the center gutter. Structural insertions/deletions show disabled visual arrows and should be merged in Source view.

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

Source merge copies the selected source hunk exactly, so it can also handle HTML structure, attributes, CSS, and inserted/deleted lines.

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

Pages whose visible content is generated only by JavaScript will not expose that generated text for editing in v0.1.

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

The Windows CI runs unit tests and the Electron UI validation **before** packaging binaries. The UI test opens two real HTML fixtures, checks visual diff highlighting and diff-local merge arrows, exercises synchronized scrolling and verifies it stays stable, verifies source rail markers are tied to the real diff rows, performs multiple merges, checks multi-level Undo/Redo, and saves the changed side. CI also keeps validation screenshots as an artifact.

## Build for Windows

```bash
npm run build:win
```

GitHub Actions also builds both Windows targets automatically:

- `HTML-Content-Editor-Setup-<version>-x64.exe`
- `HTML-Content-Editor-Portable-<version>-x64.exe`

Download them from the **Windows Build** workflow artifact named `HTML-Content-Editor-Windows`.

## License

No open-source license has been selected yet. Public source code is visible, but reuse rights are not granted until a license is added.
