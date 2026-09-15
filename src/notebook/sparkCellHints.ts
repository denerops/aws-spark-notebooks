/** SparkSession.builder...getOrCreate() would otherwise spawn a second SparkContext. */
export function cellRebuildsSparkSession(code: string): boolean {
  return /SparkSession\s*\.\s*builder/m.test(code) && /\.getOrCreate\s*\(/m.test(code);
}

/** True when a Python cell tries to configure catalogs via SparkSession.builder. */
export function cellConfiguresSparkCatalog(code: string): boolean {
  return (
    /SparkSession\s*\.\s*builder/m.test(code) &&
    /\.config\s*\(\s*['"]spark\.sql\.catalog\./m.test(code)
  );
}

export function cellStopsSpark(code: string): boolean {
  return (
    /(?:^|[^\w.])(?:spark|sc)\s*\.\s*stop\s*\(/m.test(code) ||
    /SparkContext\s*\.\s*stop\s*\(/m.test(code)
  );
}

export const SPARK_SESSION_REUSE_HINT =
  'SparkSession.builder.getOrCreate() reuses the Livy `spark` session. ' +
  'Catalog, appName, and similar builder configs are ignored — set them in Session Presets, then start a new session.';

export const SPARK_CATALOG_CELL_WARNING =
  'Catalog settings in SparkSession.builder are ignored — Livy already created Spark. ' +
  'Register catalogs in Session Presets (Spark conf), then start a new session.';

export const SPARK_STOP_IGNORED_HINT =
  'spark.stop() / sc.stop() is ignored so the Livy session stays alive. ' +
  'Disconnect the notebook or stop the session from the sidebar.';

export const SPARK_SECOND_CONTEXT_HINT =
  'Spark tried to start a second SparkContext in this Livy session ' +
  '(event log directory already exists). Use the existing `spark` variable. ' +
  'If the previous Livy session died, create a new session from the kernel picker — ' +
  'worker-local event logs cannot be deleted from the extension.';

export function collectSparkCellHints(code: string): string[] {
  const hints: string[] = [];
  if (cellRebuildsSparkSession(code)) {
    hints.push(SPARK_SESSION_REUSE_HINT);
  } else if (cellConfiguresSparkCatalog(code)) {
    hints.push(SPARK_CATALOG_CELL_WARNING);
  }
  if (cellStopsSpark(code)) {
    hints.push(SPARK_STOP_IGNORED_HINT);
  }
  return hints;
}

export function sparkRuntimeHint(message: string): string | undefined {
  if (
    /Target log directory already exists/i.test(message) ||
    /eventlog_v2_/i.test(message) ||
    /Multiple SparkContexts/i.test(message) ||
    /only one SparkContext/i.test(message)
  ) {
    return SPARK_SECOND_CONTEXT_HINT;
  }
  return undefined;
}
