# AWS Spark Notebooks

VS Code notebooks that run PySpark against AWS backends (EMR Serverless and Glue Interactive Sessions).

## Language

**Spark Backend**:
Which AWS execution environment a notebook uses: EMR Serverless or Glue Interactive Sessions.
_Avoid_: platform, provider, engine

**Notebook Connection**:
The association between an open notebook and at most one live Spark session on exactly one Spark Backend. Switching backends replaces the Session Binding; a notebook never holds two backends at once.
_Avoid_: hub, binding manager, kernel link

**Connected**:
A notebook has a live, ready Spark session it can execute cells against right now.
_Avoid_: attached (ambiguous), online

**Session Binding**:
Notebook metadata (and/or in-memory map entry) that records which Spark Backend and session id to reconnect to. Presence of a Session Binding does not imply Connected.
_Avoid_: connected metadata, sticky session

**Connection View**:
The UI-facing snapshot of a notebook’s Notebook Connection: Spark Backend, display label, detail, and whether it is Connected.
_Avoid_: kernel appearance, status model

**Spark Session Handle**:
The notebook-facing handle used to run statements and read session state, independent of Spark Backend.
_Avoid_: Livy session (when meaning the unified handle), Glue session (same)

**Standalone Session**:
A Spark session created or managed without a notebook. It has no Notebook Connection until something attaches a notebook to it.
_Avoid_: orphan session, background session

**Session Preset**:
A named, reusable configuration for creating sessions on one Spark Backend (EMR and Glue each have their own preset shape).
_Avoid_: template, profile, config set

**Preset Source**:
Where a Session Preset is stored: workspace file or user (global) storage. When the same id exists in both, workspace wins.
_Avoid_: scope, origin

**Kernel Selection**:
The UI flow that chooses a Spark Backend (unless already forced) and either attaches an existing session or creates one for the notebook through Notebook Connection.
_Avoid_: connect wizard (when meaning this unified flow), kernel picker

**Query Result**:
The tabular outcome of a successful statement: columns, rows, and row-count metadata (including truncation).
_Avoid_: table payload (when speaking in domain terms), dataframe dump

**Query Result View**:
The presentation model derived from a Query Result for display: column kinds and type badges, cell rendering, and footer row labels (including filtered counts when the UI filters).
_Avoid_: table model (ambiguous with the wire payload), HTML table
