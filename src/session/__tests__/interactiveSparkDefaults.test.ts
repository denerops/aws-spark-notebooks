import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyInteractiveSparkDefaults } from '../interactiveSparkDefaults';
import { EMR_DISPLAY_BOOTSTRAP } from '../../livy/types';

describe('interactive Spark session defaults', () => {
  it('sets spark.eventLog.overwrite unless the conf already defined it', () => {
    const conf: Record<string, string> = { 'spark.sql.shuffle.partitions': '8' };
    applyInteractiveSparkDefaults(conf);
    assert.equal(conf['spark.eventLog.overwrite'], 'true');
    assert.equal(conf['spark.sql.shuffle.partitions'], '8');

    const kept: Record<string, string> = { 'spark.eventLog.overwrite': 'false' };
    applyInteractiveSparkDefaults(kept);
    assert.equal(kept['spark.eventLog.overwrite'], 'false');
  });

  it('patches SparkSession.builder.getOrCreate in the Livy bootstrap', () => {
    assert.match(EMR_DISPLAY_BOOTSTRAP, /__emr_reuse_livy_spark/);
    assert.match(EMR_DISPLAY_BOOTSTRAP, /Builder\.getOrCreate/);
  });
});
