# Shared Session Preset store and UI shell; keep backend shapes separate

EMR and Glue each had a full preset stack (store, workspace file I/O, webview controller, commands, QuickPicks) with duplicated merge/save rules and save-time package validation living only in the UI. We collapse persistence and UX chrome into shared modules under `src/presets/`: a generic `createPresetStore<T>(config)` (storage key, workspace file, preferWorkspace, normalize, buildDefault), shared workspace I/O, a webview shell with per-backend form fragments, and parameterized commands/pickers. EMR and Glue **Session Preset** shapes stay separate in their preset models. Normalize/assert runs on every store save so actions cannot bypass invariants. Land in one PR with tests for store policy and the shell message protocol.

## Considered Options

- **Unify EMR/Glue into one preset type** — rejected: domain fields differ for good reasons; muddies Session Preset language.
- **Store-only deepen; leave twin UI/actions** — rejected for this change set: user chose shell + commands in scope.
- **One mega-editor with backend conditionals** — rejected: couples forms and fights separate shapes.
- **Strategy/inheritance for the store** — rejected: config bag + normalize fn is enough for two backends.
- **Validation only in the UI** — rejected: `store.save` from actions skipped rules.
- **Split across multiple PRs** — rejected in favor of one PR.

## Consequences

- Future reviews should not re-propose merging EMR/Glue preset *shapes*, or moving invariants back into controllers, unless this ADR is superseded.
- Candidate “Notebook Connection” deepen (ADR-0001) remains separate work.
