export interface LivySessionInfo {
  id: number;
  name?: string;
  owner?: string;
  kind?: string;
  state: string;
  appId?: string;
  log?: string[];
}

export function formatLivySessionLabel(session: Pick<LivySessionInfo, 'id' | 'name'>): string {
  const name = session.name?.trim();
  return name || `Session ${session.id}`;
}

export function parseLivySessionInfo(raw: unknown): LivySessionInfo | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const idValue = record.id ?? record.sessionId;
  const id = typeof idValue === 'number' ? idValue : Number(idValue);
  if (!Number.isFinite(id)) {
    return undefined;
  }

  return {
    id,
    name: typeof record.name === 'string' ? record.name : undefined,
    owner: typeof record.owner === 'string' ? record.owner : undefined,
    kind: typeof record.kind === 'string' ? record.kind : undefined,
    state: typeof record.state === 'string' ? record.state : 'unknown',
    appId: typeof record.appId === 'string' ? record.appId : undefined,
    log: Array.isArray(record.log) ? record.log.map(String) : undefined,
  };
}

export interface LivyStatement {
  id: number;
  code: string;
  state: string;
  output?: LivyStatementOutput;
  progress?: number;
}

export interface LivyStatementOutput {
  status: string;
  execution_count?: number;
  data?: Record<string, string>;
  evalue?: string;
  ename?: string;
  traceback?: string[];
}

export type StatementKind = 'pyspark' | 'sql';

export const TABLE_JSON_MARKER = '__EMR_TABLE_JSON__';
export const TABLE_COUNT_MARKER = '__EMR_COUNT_JSON__';

export const EMR_DISPLAY_BOOTSTRAP = `
def emr_show(obj, limit=1000, _count_expr=None):
    import json
    try:
        from pyspark.sql import DataFrame
    except ImportError:
        DataFrame = tuple()
    if DataFrame and isinstance(obj, DataFrame):
        cols = list(obj.columns)
        peek = obj.limit(limit + 1)
        rows = [list(r) for r in peek.collect()]
        truncated = len(rows) > limit
        if truncated:
            rows = rows[:limit]
        displayed = len(rows)
        meta = {
            "columns": cols,
            "rows": rows,
            "rowCount": displayed,
            "truncated": truncated,
            "countExact": not truncated,
            "displayLimit": limit,
        }
        if truncated and _count_expr:
            meta["countCode"] = _count_expr
        print("${TABLE_JSON_MARKER}" + json.dumps(meta, default=str))
    else:
        print(repr(obj))

def emr_display(df, limit=1000, _count_expr=None):
    return emr_show(df, limit=limit, _count_expr=_count_expr)

def __emr_pip_target_dir():
    import os
    base = os.environ.get("EMR_SERVERLESS_DRIVER_TEMP", "/tmp")
    return os.path.join(base, "emr-notebook-pip")

def __emr_register_pip_target(target):
    import importlib
    import os
    import site
    import sys
    import zipfile

    if not os.path.isdir(target):
        return

    if target not in sys.path:
        sys.path.insert(0, target)
    site.addsitedir(target)
    importlib.invalidate_caches()

    try:
        from pyspark.sql import SparkSession

        spark = SparkSession.getActiveSession()
        if spark is None:
            return

        zip_path = target.rstrip("/") + "-deps.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(target):
                for name in files:
                    if name.endswith(".pyc") or ".dist-info" in root:
                        continue
                    full = os.path.join(root, name)
                    arc = os.path.relpath(full, target)
                    if arc.startswith(".dist-info"):
                        continue
                    zf.write(full, arc)
        spark.sparkContext.addPyFile("file://" + zip_path)
    except Exception as exc:
        print(f"Warning: installed on driver but could not sync to executors: {exc}")

def __emr_run_pip(arg_string):
    import os
    import shlex
    import subprocess
    import sys

    args = shlex.split(arg_string)
    pip_args = list(args)
    target = __emr_pip_target_dir()
    os.makedirs(target, exist_ok=True)

    if pip_args and pip_args[0] == "install":
        extras = []
        if "--target" not in pip_args and "-t" not in pip_args:
            extras.extend(["--target", target])
        if "--user" in pip_args:
            pip_args = [a for a in pip_args if a != "--user"]
        if "--no-cache-dir" not in pip_args:
            extras.append("--no-cache-dir")
        pip_args = pip_args[:1] + extras + pip_args[1:]

    proc = subprocess.run(
        [sys.executable, "-m", "pip"] + pip_args,
        capture_output=True,
        text=True,
    )
    if proc.stdout:
        print(proc.stdout, end="")
    if proc.stderr:
        print(proc.stderr, end="")
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or "unknown error"
        raise RuntimeError(f"pip failed with exit code {proc.returncode}: {detail}")

    if pip_args and pip_args[0] == "install":
        __emr_register_pip_target(target)
        print(f"Packages registered for import from {target}")

__emr_register_pip_target(__emr_pip_target_dir())
`.trim();
