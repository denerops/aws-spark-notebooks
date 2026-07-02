import { getSparkConfSuggestionsForEditor, type SparkConfSuggestion } from '../session/sparkConfSuggestions';

export const GLUE_JOB_ARGUMENT_SUGGESTIONS: SparkConfSuggestion[] = [
  {
    key: '--enable-glue-datacatalog',
    value: 'true',
    description: 'Use the AWS Glue Data Catalog as the Spark Hive metastore',
  },
  {
    key: '--enable-metrics',
    value: 'false',
    description: 'Collect job profiling metrics for the session',
  },
  {
    key: '--user-jars-first',
    value: 'true',
    description: 'Resolve user JARs before Glue-provided JARs',
  },
  {
    key: '--additional-python-modules',
    value: 'pandas==2.0.0',
    description: 'Comma-separated PyPI modules installed at session start',
  },
  {
    key: '--extra-py-files',
    value: 's3://your-bucket/lib/helpers.zip',
    description: 'Extra Python files available on Spark PYTHONPATH',
  },
  {
    key: '--TempDir',
    value: 's3://your-bucket/temp/',
    description: 'S3 path for temporary files written by the session',
  },
  {
    key: '--enable-continuous-cloudwatch-log',
    value: 'true',
    description: 'Stream session logs to CloudWatch continuously',
  },
  {
    key: '--enable-continuous-log-filter',
    value: 'true',
    description: 'Filter noisy continuous CloudWatch logs',
  },
  {
    key: '--enable-spark-ui',
    value: 'true',
    description: 'Enable the Spark UI for the interactive session',
  },
  {
    key: '--spark-event-logs-path',
    value: 's3://your-bucket/spark-history/',
    description: 'S3 path for Spark event logs',
  },
];

export function getGlueDefaultArgumentSuggestionsForEditor(): SparkConfSuggestion[] {
  const byKey = new Map<string, SparkConfSuggestion>();

  for (const suggestion of getSparkConfSuggestionsForEditor()) {
    byKey.set(suggestion.key, suggestion);
  }
  for (const suggestion of GLUE_JOB_ARGUMENT_SUGGESTIONS) {
    if (!byKey.has(suggestion.key)) {
      byKey.set(suggestion.key, suggestion);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}
