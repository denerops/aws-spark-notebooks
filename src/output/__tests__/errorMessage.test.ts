import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractErrorMessage } from '../errorMessage';
import { SPARK_SECOND_CONTEXT_HINT } from '../../notebook/sparkCellHints';

describe('extractErrorMessage', () => {
  it('prefixes leftover eventlog collisions with an actionable hint', () => {
    const message = extractErrorMessage(
      new Error(
        'java.lang.IllegalArgumentException: Target log directory already exists (file:/var/log/spark/apps/eventlog_v2_00abc)\n\tat org.apache.spark.scheduler.EventLoggingListener'
      )
    );
    assert.ok(message.includes(SPARK_SECOND_CONTEXT_HINT));
    assert.match(message, /Target log directory already exists/);
  });

  it('leaves unrelated errors unchanged', () => {
    assert.equal(extractErrorMessage(new Error('AnalysisException: Table not found')), 'AnalysisException: Table not found');
  });
});
