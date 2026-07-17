# Deep Notebook Connection module; close manager getters

Notebook connection logic was split across a shallow hub and twin EMR/Glue managers, with `getEmrManager` / `getGlueManager` letting callers re-learn both backends and redefine “connected.” We deepen a single **Notebook Connection** module that owns the full notebook↔session lifecycle (bind, ensure, create-for-notebook, attach, disconnect, release, Connection View, Spark UI target, and the one-backend-per-notebook Session Binding mutex). EMR and Glue shrink to **Spark Backend adapters** for list/standalone-create/stop and AWS session work; they do not write notebook metadata. Callers must not reach concrete managers through the connection module. `isConnected` means live+ready; `hasSessionBinding` means reconnectable — no third helper. Create/attach use discriminated params per Spark Backend. Land in one PR with tests for policy, Connection View, and Spark UI target against fake adapters.

## Considered Options

- **Shallow hub + twin managers with public getters** (status quo) — rejected: fails the deletion test; “connected” leaks across call sites.
- **Binding-only deepen** (hub owns map/mutex; create/attach stay on managers) — rejected: getters and wizard branching survive.
- **Keep getters during/after deepen** — rejected: escape hatch recreates shallowness.
- **Standalone create on Notebook Connection** — rejected: fattens the interface with non-notebook UX; adapters already vary.
- **Strangler across multiple PRs** — rejected in favor of one PR for this change set.

## Consequences

- Sidebar trees inject adapters directly for list/standalone create; notebook attach/create goes only through Notebook Connection.
- Future architecture reviews should not re-propose a dual-manager hub with manager getters unless this ADR is superseded.
