import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keepAliveIntervalMs } from '../keepAlive';

describe('keepAliveIntervalMs', () => {
  it('pings at one third of the Livy orphan timeout', () => {
    assert.equal(keepAliveIntervalMs(60), 20_000);
    assert.equal(keepAliveIntervalMs(30), 10_000);
  });

  it('disables keep-alive when heartbeat timeout is 0 or invalid', () => {
    assert.equal(keepAliveIntervalMs(0), 0);
    assert.equal(keepAliveIntervalMs(-1), 0);
    assert.equal(keepAliveIntervalMs(Number.NaN), 0);
  });

  it('never pings faster than every 5 seconds', () => {
    assert.equal(keepAliveIntervalMs(3), 5_000);
  });
});
