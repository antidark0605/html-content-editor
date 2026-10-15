# Agent Guidelines for HTML Content Editor

These instructions apply to this repository. Read `README.md` and inspect the relevant source and tests before modifying behavior.

## Project goal

**Edit text. Preserve layout.** This is a Windows Electron desktop application for changing visible text in existing HTML files, reviewing the result, and comparing HTML files without unnecessarily rewriting their markup or styling.

The user's original HTML is the source of truth. Prioritize predictable edits, visual fidelity, and undoability over convenience shortcuts.

## Non-negotiable behavior

- Preserve original HTML source, CSS, classes, IDs, inline styles, comments, whitespace outside the edited range, and relative asset references unless a change explicitly requires otherwise.
- Prefer source-offset / source-range patches to serializing and rewriting the entire DOM. The parser is for locating editable content, not for reformatting documents.
- Keep HTML text properly escaped when inserting user-entered text.
- Do not treat every empty element as disposable. Remove an empty wrapper (for example, a `span` whose sole text was deleted) only when the operation explicitly calls for it and no other content or behavior would be lost. Add focused tests.
- Preserve usable scrolling and content viewport height across Edit, Preview, and Diff. Preview should display the working HTML as a read-only, helper-free render; do not leak editing decorations into it.
- Keep Edit / Preview / Diff behavior consistent with the working source, including Undo / Redo and unsaved-change tracking.
- Visual Compare merges visible text conservatively, preserving the destination structure. Use Source Compare for structural changes, and do not silently make structural edits look like text-only merges.
- Do not silently discard unsaved edits when switching modes, files, or workspaces.

## Code map

- `src/html-model.mjs`: visible text extraction, source-preserving text patches, and inline formatting.
- `src/table-model.mjs`: table identification and limited structural table operations.
- `src/compare-model.mjs` and `src/compare-utils.mjs`: visual/source comparison, merges, and compare helpers.
- `src/main.mjs`: Electron main process, file access, sessions, saves/backups, and IPC handlers.
- `src/preload.cjs`: explicitly exposed renderer-to-main API.
- `src/renderer/app.js`: UI state, events, modes, edit/preview/compare rendering.
- `src/renderer/index.html` and `src/renderer/styles.css`: application interface and layout.
- `tests/*.test.mjs`: model and utility unit tests.
- `tests/ui-smoke.mjs`: real Electron UI smoke/regression coverage.
- `.github/workflows/windows-build.yml`: Windows validation and packaging workflow.

Keep responsibilities separated. Prefer small, focused helpers or modules instead of adding unrelated logic to the already large `src/renderer/app.js`. Respect existing APIs and behavior when refactoring.

## Editing and rendering safety

- Existing HTML may be untrusted. **Do not enable page JavaScript** in Edit, Preview, or Compare frames, and do not weaken the existing sandbox without a carefully reviewed security reason.
- Do not expose Node.js, Electron internals, arbitrary filesystem access, or unrestricted IPC to HTML loaded in the renderer frames.
- Respect the existing excluded/non-editable content rules for scripts, styles, templates, metadata, form values, SVG/MathML, and other unsupported regions.
- Preserve the distinction between temporary edit helpers and the actual saved HTML.
- Preserve the backup-on-first-overwrite behavior. Do not overwrite an original file without the existing save/backup safeguards.
- Avoid broad DOM cleanup, CSS injection that permanently alters user content, and regex-based rewrites of arbitrary HTML structure.
- Avoid adding heavyweight dependencies or new network features unless the feature needs them.

## Testing expectations

For behavior changes, add or update regression coverage for the actual failure case and at least one nearby case that should remain unchanged.

- Run `npm test` for model and utility changes.
- Run `npm run test:ui` when Edit, Preview, Compare, styling, interaction, or viewport behavior changes. This uses Electron and requires a suitable GUI-capable environment.
- Run `npm run build:win` for local Windows packaging validation when the environment supports it.
- On pull requests, the Windows GitHub Actions workflow installs dependencies, runs unit tests and Electron UI validation, and retains UI screenshots when available.
- The Windows setup and portable executables are produced by the workflow on pushes to `main` or manual workflow dispatch; ordinary PR checks do not build those executables.
- Do not claim tests passed or a build artifact exists unless the relevant command/workflow completed successfully. If a test cannot run locally, state that clearly and rely on CI results before reporting validation.

Critical regression cases include: deleting text inside a styled span without leaving an unintended empty box; preserving spans with other child content; Preview using the available workspace height; Edit/Preview output parity; formatting, table operations, Undo/Redo, and both Compare modes.

## Change and release workflow

1. Inspect the current default branch, open PRs, relevant tests, and existing behavior before editing; other agents may be working concurrently.
2. Keep changes narrow, with no unrelated formatting or dependency churn.
3. Work on a dedicated branch and submit a focused pull request for review. Do not overwrite another agent's branch or force-push over their work.
4. Review the diff and test evidence. Fix failing checks before merging; distinguish actual code failures from incorrect test assertions.
5. Keep `README.md` in sync when user-facing features, limitations, or build instructions change.
6. For a deliberate new Windows release, update the version in `package.json` and verify the resulting `main` workflow successfully uploads both setup and portable artifacts. Do not bump versions for unrelated documentation-only changes.
7. Report what changed, the PR/commit, what was tested, what remains unverified, and where any downloadable artifacts actually reside.

## Public-repository privacy

This repository is public. Never commit company/internal content, customer HTML, private test pages, credentials, tokens, API keys, personal identifiers, device details, logs containing sensitive data, or proprietary screenshots. Use small synthetic HTML fixtures for tests. Avoid telemetry and persistent diagnostic logging unless explicitly requested and reviewed.

## Documentation scope

Use this file for stable project-wide engineering guidance, not task-specific instructions or a log of every issue. Keep `README.md` for user-facing documentation and GitHub issues/PRs for the history and discussion of individual changes.
