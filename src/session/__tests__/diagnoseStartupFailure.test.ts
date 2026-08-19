import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  diagnoseGlueStartupFailure,
  diagnoseLivyStartupFailure,
  SessionStartupFailureError,
} from '../diagnoseStartupFailure';

const UNRESOLVED_LOG = [
  'stdout: ',
  ':: resolving dependencies ::',
  '	::::::::::::::::::::::::::::::::::::::::::::::',
  '	::          UNRESOLVED DEPENDENCIES         ::',
  '	::::::::::::::::::::::::::::::::::::::::::::::',
  '	:: org.apache.spark#spark-sql-kafka-0-10_2.12;3.5.9: not found',
  '	::::::::::::::::::::::::::::::::::::::::::::::',
  '',
  ':: USE VERBOSE OR DEBUG MESSAGE LEVEL FOR MORE DETAILS',
  'Exception in thread "main" java.lang.RuntimeException: [unresolved dependency: org.apache.spark#spark-sql-kafka-0-10_2.12;3.5.9: not found]',
  '	at org.apache.spark.deploy.SparkSubmitUtils$.resolveMavenDependencies(SparkSubmitUtils.scala:160)',
];

const TIMEOUT_LOG = [
  ':: retrieving :: org.apache.iceberg#iceberg-spark-runtime-3.5_2.12',
  'Server access Error: Connection timed out url=https://repo1.maven.org/maven2/org/apache/iceberg/iceberg-spark-runtime-3.5_2.12/1.5.0/iceberg-spark-runtime-3.5_2.12-1.5.0.pom',
  'java.net.ConnectException: Connection timed out',
];

describe('diagnoseLivyStartupFailure', () => {
  it('extracts unresolved Maven coordinates from Ivy logs', () => {
    const failure = diagnoseLivyStartupFailure({
      state: 'dead',
      logLines: UNRESOLVED_LOG,
      sessionId: 7,
    });

    assert.equal(failure.category, 'unresolved_spark_package');
    assert.equal(failure.sessionId, 7);
    assert.match(failure.summary, /state: dead/);
    assert.match(
      failure.summary,
      /Spark package not found: org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.9/
    );
    assert.match(failure.detail, /unresolved dependency/);
    assert.equal(failure.logLines.length, UNRESOLVED_LOG.length);
  });

  it('detects Maven repo network failures', () => {
    const failure = diagnoseLivyStartupFailure({
      state: 'dead',
      logLines: TIMEOUT_LOG,
    });

    assert.equal(failure.category, 'repo_unreachable');
    assert.match(failure.summary, /could not reach Maven repositories/);
    assert.match(failure.detail, /Connection timed out/);
  });

  it('falls back to the main exception line', () => {
    const failure = diagnoseLivyStartupFailure({
      state: 'error',
      logLines: [
        'Starting Spark',
        'Exception in thread "main" java.lang.IllegalArgumentException: Invalid spark.executor.memory',
        '	at org.apache.spark.SparkConf.validate(SparkConf.scala:1)',
      ],
    });

    assert.equal(failure.category, 'unknown');
    assert.match(failure.summary, /Invalid spark.executor.memory/);
  });

  it('keeps a generic summary when logs are empty', () => {
    const failure = diagnoseLivyStartupFailure({ state: 'dead' });
    assert.equal(failure.category, 'unknown');
    assert.equal(failure.summary, 'Session failed to start (state: dead)');
    assert.deepEqual(failure.logLines, []);
  });
});

describe('diagnoseGlueStartupFailure', () => {
  it('parses Ivy text inside Glue ErrorMessage', () => {
    const failure = diagnoseGlueStartupFailure({
      status: 'FAILED',
      errorMessage: 'java.lang.RuntimeException: [unresolved dependency: org.foo#bar;1.0: not found]',
      sessionId: 'glue-1',
    });

    assert.equal(failure.category, 'unresolved_spark_package');
    assert.equal(failure.sessionId, 'glue-1');
    assert.match(failure.summary, /status: FAILED/);
    assert.match(failure.summary, /Spark package not found: org.foo:bar:1.0/);
  });

  it('uses the raw ErrorMessage when it is not a known pattern', () => {
    const failure = diagnoseGlueStartupFailure({
      status: 'FAILED',
      errorMessage: 'Role session-role cannot be assumed',
    });

    assert.equal(failure.category, 'unknown');
    assert.equal(
      failure.summary,
      'Glue session failed to start (status: FAILED): Role session-role cannot be assumed'
    );
  });

  it('handles missing ErrorMessage', () => {
    const failure = diagnoseGlueStartupFailure({ status: 'TIMEOUT' });
    assert.equal(failure.summary, 'Glue session failed to start (status: TIMEOUT)');
  });
});

describe('SessionStartupFailureError', () => {
  it('exposes the summary as the Error message', () => {
    const failure = diagnoseLivyStartupFailure({
      state: 'dead',
      logLines: UNRESOLVED_LOG,
    });
    const error = new SessionStartupFailureError(failure);
    assert.equal(error.message, failure.summary);
    assert.equal(error.failure, failure);
  });
});
