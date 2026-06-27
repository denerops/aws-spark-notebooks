import { buildDefaultSparkConf } from './presetModel';

export interface SparkConfSuggestion {
  key: string;
  value?: string;
  description?: string;
}

/** Curated Spark / EMR Serverless conf keys for preset editor autocomplete. */
export const SPARK_CONF_SUGGESTIONS: SparkConfSuggestion[] = [
  {
    key: 'spark.dynamicAllocation.enabled',
    value: 'false',
    description: 'Disable dynamic allocation for fixed executor count',
  },
  {
    key: 'spark.executor.instances',
    value: '1',
    description: 'Fixed executor count when dynamic allocation is off',
  },
  {
    key: 'spark.emr-serverless.executor.disk',
    value: '40G',
    description: 'Local disk per executor on EMR Serverless',
  },
  {
    key: 'spark.emr-serverless.driver.disk',
    value: '20G',
    description: 'Local disk for the Spark driver on EMR Serverless',
  },
  {
    key: 'spark.sql.extensions',
    value: 'org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions',
    description: 'Enable Iceberg SQL extensions',
  },
  {
    key: 'spark.sql.catalog.spark_catalog',
    value: 'org.apache.iceberg.spark.SparkSessionCatalog',
    description: 'Default Iceberg catalog implementation',
  },
  {
    key: 'spark.sql.catalog.spark_catalog.type',
    value: 'glue',
    description: 'Glue Data Catalog for spark_catalog',
  },
  {
    key: 'spark.sql.catalog.glue_catalog',
    value: 'org.apache.iceberg.spark.SparkCatalog',
    description: 'Named Iceberg catalog (SparkCatalog)',
  },
  {
    key: 'spark.sql.catalog.glue_catalog.catalog-impl',
    value: 'org.apache.iceberg.aws.glue.GlueCatalog',
    description: 'Glue implementation for glue_catalog',
  },
  {
    key: 'spark.sql.catalog.glue_catalog.warehouse',
    value: 's3://your-bucket/',
    description: 'Iceberg warehouse path for glue_catalog',
  },
  {
    key: 'spark.sql.catalog.glue_catalog.io-impl',
    value: 'org.apache.iceberg.aws.s3.S3FileIO',
    description: 'S3 file IO for glue_catalog',
  },
  {
    key: 'spark.sql.defaultCatalog',
    value: 'spark_catalog',
    description: 'Default catalog for unqualified table names',
  },
  {
    key: 'spark.sql.adaptive.enabled',
    value: 'true',
    description: 'Adaptive Query Execution (AQE)',
  },
  {
    key: 'spark.sql.adaptive.coalescePartitions.enabled',
    value: 'true',
    description: 'Coalesce shuffle partitions with AQE',
  },
  {
    key: 'spark.sql.shuffle.partitions',
    value: '200',
    description: 'Default number of shuffle partitions',
  },
  {
    key: 'spark.serializer',
    value: 'org.apache.spark.serializer.KryoSerializer',
    description: 'Kryo serializer for RDD/shuffle data',
  },
  {
    key: 'spark.sql.parquet.mergeSchema',
    value: 'true',
    description: 'Merge Parquet schemas across files',
  },
  {
    key: 'spark.hadoop.fs.s3a.fast.upload',
    value: 'true',
    description: 'Buffered S3 uploads from executors',
  },
  {
    key: 'spark.archives',
    value: 's3://your-bucket/venv.tar.gz#environment',
    description: 'Python venv archive for executors (#environment)',
  },
  {
    key: 'spark.pyspark.python',
    value: './environment/bin/python',
    description: 'Python interpreter from spark.archives venv',
  },
  {
    key: 'spark.pyspark.driver.python',
    value: './environment/bin/python',
    description: 'Driver Python interpreter from venv archive',
  },
];

export function getSparkConfSuggestionsForEditor(): SparkConfSuggestion[] {
  const byKey = new Map<string, SparkConfSuggestion>();

  for (const suggestion of SPARK_CONF_SUGGESTIONS) {
    byKey.set(suggestion.key, suggestion);
  }

  for (const [key, value] of Object.entries(buildDefaultSparkConf())) {
    if (key === 'emr-serverless.session.executionRoleArn') {
      continue;
    }
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.value && value) {
        byKey.set(key, { ...existing, value });
      }
      continue;
    }
    byKey.set(key, { key, value });
  }

  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}
