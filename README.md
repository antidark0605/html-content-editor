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
- Windows installer and portable executable built by GitHub Actions

## Safety model

HTML can contain executable JavaScript. In v0.1, page scripts are intentionally **disabled** in both Edit and Preview mode. CSS, images, and normal HTML layout can still render.

This repository is public. Do not commit private/internal HTML samples, credentials, API keys, customer data, or proprietary material.

Windows builds are currently unsigned, so Microsoft SmartScreen may warn when launching a downloaded build. Code signing can be added later.

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

```bash
npm test
```

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
