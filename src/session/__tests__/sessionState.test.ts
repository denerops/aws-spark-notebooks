import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SessionStartupFailureError } from '../diagnoseStartupFailure';
import { isSessionGoneError } from '../sessionState';

describe('isSessionGoneError', () => {
  it('treats startup failure and 404 as gone', () => {
    assert.equal(
      isSessionGoneError(
        new SessionStartupFailureError({
          category: 'unknown',
          summary: 'dead',
          detail: '',
          logLines: [],
        })
      ),
      true
    );
    assert.equal(isSessionGoneError(new Error('Livy API error (404): missing')), true);
    assert.equal(isSessionGoneError(new Error('EntityNotFoundException')), true);
  });

  it('does not treat throttle or 5xx as gone', () => {
    assert.equal(isSessionGoneError(new Error('Livy API error (503): unavailable')), false);
    assert.equal(isSessionGoneError(new Error('Too Many Requests')), false);
  });
});
