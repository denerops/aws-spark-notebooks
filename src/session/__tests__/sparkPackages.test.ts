import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertValidSparkPackageSpecs,
  isValidSparkPackageSpec,
} from '../sparkPackages';

describe('spark package GAV specs', () => {
  it('accepts group:artifact:version and optional classifier', () => {
    assert.equal(
      isValidSparkPackageSpec('org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.5.0'),
      true
    );
    assert.equal(isValidSparkPackageSpec('org.foo:bar:1.0:tests'), true);
  });

  it('rejects specs that are not Maven GAV', () => {
    assert.equal(isValidSparkPackageSpec('iceberg-spark'), false);
    assert.equal(isValidSparkPackageSpec('org.foo:bar'), false);
    assert.equal(isValidSparkPackageSpec('org.foo:bar:1,evil'), false);
  });

  it('assert lists the invalid specs', () => {
    assert.throws(
      () => assertValidSparkPackageSpecs(['iceberg-spark', 'org.foo:bar:1.0']),
      /iceberg-spark/
    );
  });
});
