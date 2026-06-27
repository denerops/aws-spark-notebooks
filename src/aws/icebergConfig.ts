import { getExtensionConfig } from './config';

/** Default Iceberg + Glue via SparkSessionCatalog (EMR Serverless standard). */
export const DEFAULT_ICEBERG_SESSION_CONF: Record<string, string> = {
  'spark.sql.extensions': 'org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions',
  'spark.sql.catalog.spark_catalog': 'org.apache.iceberg.spark.SparkSessionCatalog',
  'spark.sql.catalog.spark_catalog.type': 'glue',
};

export interface GlueCatalogProfile {
  enabled?: boolean;
  /** Catalog name registered in Spark (default glue_catalog). */
  name?: string;
  /** Iceberg warehouse path, e.g. s3://my-bucket/ */
  warehouse: string;
}

function buildGlueCatalogConf(profile: GlueCatalogProfile): Record<string, string> {
  const name = profile.name?.trim() || 'glue_catalog';
  const warehouse = profile.warehouse.trim();
  if (!warehouse) {
    return {};
  }
  return {
    [`spark.sql.catalog.${name}`]: 'org.apache.iceberg.spark.SparkCatalog',
    [`spark.sql.catalog.${name}.catalog-impl`]: 'org.apache.iceberg.aws.glue.GlueCatalog',
    [`spark.sql.catalog.${name}.warehouse`]: warehouse,
    [`spark.sql.catalog.${name}.io-impl`]: 'org.apache.iceberg.aws.s3.S3FileIO',
  };
}

/**
 * Spark conf for Iceberg catalogs merged into every new Livy session.
 * Supports spark_catalog (default) plus optional glue_catalog and extra keys.
 */
export function getIcebergCatalogConfig(): Record<string, string> {
  const config = getExtensionConfig();
  const enabled = config.get<boolean>('icebergCatalog.enabled', true);
  if (!enabled) {
    return {};
  }

  const conf: Record<string, string> = {
    ...DEFAULT_ICEBERG_SESSION_CONF,
    ...config.get<Record<string, string>>('icebergCatalog.sessionConf', {}),
    ...config.get<Record<string, string>>('icebergCatalog.additionalCatalogConf', {}),
  };

  const glueProfile = config.get<GlueCatalogProfile>('icebergCatalog.glueCatalog', {
    enabled: false,
    warehouse: '',
  });
  if (glueProfile?.enabled && glueProfile.warehouse) {
    Object.assign(conf, buildGlueCatalogConf(glueProfile));
  }

  return conf;
}

export function getIcebergCatalogName(): string {
  return getExtensionConfig().get<string>('icebergCatalog.catalogName', 'spark_catalog');
}

/** True when a Python cell tries to configure catalogs via SparkSession.builder. */
export function cellConfiguresSparkCatalog(code: string): boolean {
  return (
    /SparkSession\s*\.\s*builder/m.test(code) &&
    /\.config\s*\(\s*['"]spark\.sql\.catalog\./m.test(code)
  );
}

export const SPARK_CATALOG_CELL_WARNING =
  'Catalog settings in SparkSession.builder are ignored — Livy already created Spark. ' +
  'Register catalogs in Session Presets (Spark conf), then start a new session.';
