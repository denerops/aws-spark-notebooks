import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SPARK_CATALOG_CELL_WARNING,
  SPARK_SECOND_CONTEXT_HINT,
  SPARK_SESSION_REUSE_HINT,
  SPARK_STOP_IGNORED_HINT,
  cellRebuildsSparkSession,
  cellStopsSpark,
  collectSparkCellHints,
  sparkRuntimeHint,
} from '../sparkCellHints';

describe('spark cell hints', () => {
  it('detects SparkSession.builder.getOrCreate across wrapped lines', () => {
    const code = `
spark = (
    SparkSession.builder
    .appName("Iceberg")
    .config("spark.sql.catalog.spark_catalog", "org.apache.iceberg.spark.SparkSessionCatalog")
    .getOrCreate()
)
`;
    assert.equal(cellRebuildsSparkSession(code), true);
    assert.deepEqual(collectSparkCellHints(code), [SPARK_SESSION_REUSE_HINT]);
  });

  it('falls back to catalog warning when builder has no getOrCreate', () => {
    const code = `
SparkSession.builder.config("spark.sql.catalog.spark_catalog", "x")
`;
    assert.equal(cellRebuildsSparkSession(code), false);
    assert.deepEqual(collectSparkCellHints(code), [SPARK_CATALOG_CELL_WARNING]);
  });

  it('detects spark.stop and sc.stop', () => {
    assert.equal(cellStopsSpark('spark.stop()'), true);
    assert.equal(cellStopsSpark('sc.stop()'), true);
    assert.equal(cellStopsSpark('print(spark.stop_reason)'), false);
    assert.deepEqual(collectSparkCellHints('spark.stop()'), [SPARK_STOP_IGNORED_HINT]);
  });

  it('maps event log collisions to a second-context hint', () => {
    const err =
      'java.io.IOException: Target log directory already exists (file:/var/log/spark/apps/eventlog_v2_00g8ps96l61lip0a)';
    assert.equal(sparkRuntimeHint(err), SPARK_SECOND_CONTEXT_HINT);
  });
});
