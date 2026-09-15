/** Spark conf applied to every new Livy/Glue session unless the preset already sets the key. */
export const INTERACTIVE_SESSION_SPARK_DEFAULTS: Record<string, string> = {
  // EMR Serverless reuses workers; leftover eventlog_v2_<appId> dirs crash a new SparkContext.
  'spark.eventLog.overwrite': 'true',
};

export function applyInteractiveSparkDefaults(conf: Record<string, string>): void {
  for (const [key, value] of Object.entries(INTERACTIVE_SESSION_SPARK_DEFAULTS)) {
    if (conf[key] === undefined) {
      conf[key] = value;
    }
  }
}
