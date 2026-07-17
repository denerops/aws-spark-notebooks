# Shared Query Result View in tableModel; thin HTML and renderer adapters

Static HTML (`htmlTable`) and the interactive notebook renderer duplicated footer row labels and column header chrome while already sharing classify/escape helpers. We deepen **Query Result View** inside `tableModel`: derive columns (name, kind, type badge), cell rendering, and footer labels (exact / truncated / optional filtered count) from `QueryResultPayload`. `htmlTable` and `tableRenderer` become thin adapters that mount that view. Sort and filter stay in the interactive renderer. `QueryResultPayload` remains the wire shape from `resultMapper`. Ship view-model unit tests (no DOM).

## Considered Options

- **Also move sort/filter helpers into the view-model** — deferred: not duplicated on the static path; keep Q1 scope tight.
- **New sibling module instead of expanding tableModel** — rejected: payload→view is one concept; extra file is a shallow hop.
- **Renderer imports htmlTable** — rejected: inverts the seam (interactive depends on static adapter).
- **Pre-rendered header HTML in the view** — rejected: awkward for DOM sort targets.
- **Filtered footer only in the renderer** — rejected: same sentence family as truncated/exact; locality belongs in one footer API.

## Consequences

- Do not re-fork footer or column-badge formatting in adapters unless this ADR is superseded.
- Interactive-only behavior (sort, filter UI) must not be pushed into the shared view without revisiting scope.
