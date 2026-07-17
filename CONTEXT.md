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
