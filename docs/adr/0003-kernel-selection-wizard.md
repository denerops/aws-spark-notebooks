# Shared Kernel Selection wizard; step adapters list via Spark Backend adapters

EMR and Glue kernel selectors duplicated prompt-lock, attach-vs-create QuickPick, progress, and error handling while listing sessions through raw AWS/Livy clients. After Notebook Connection (ADR-0001) is complete, we deepen a single **Kernel Selection** flow: shared wizard shell plus per-backend step adapters (`listAttachTargets`, `pickCreateParams`). Listing goes through Spark Backend adapters — not Notebook Connection and not direct service imports in UI. `connectWizard` and `kernelManager.promptKernelSelection` both call one `selectKernel`; reconnect (`hasSessionBinding` → `ensureConnected`) stays on the execution path. A forced Spark Backend skips the backend picker. Tests cover the shell choreography and step-adapter DTO mapping with fakes.

## Considered Options

- **Implement before ADR-0001 finishes** — rejected: attach/create call sites would be rewritten twice.
- **One mega-function with `if (backend)`** — rejected: shallow; callers learn both backends again.
- **List attach targets on Notebook Connection** — rejected: fattens lifecycle with UI discovery; conflicts with ADR-0001 adapter split.
- **Keep listing via AWS clients in UI** — rejected: wizard shell hard to test; SDK leaks past the seam.
- **Kernel manager as sole entry (delete connect orchestration)** — rejected: couples connect command to controller lifecycle.
- **Forced backend still offers switch** — rejected: fights one-backend-per-notebook intent from the sidebar.

## Consequences

- Do not land this until ADR-0001’s Notebook Connection interface is the real attach/create path end-to-end.
- Future reviews should not re-propose twin selectors or putting session listing on Notebook Connection unless this ADR is superseded.
