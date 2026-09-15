import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { EmrSessionCatalog, GlueSessionCatalog } from '../sessionCatalog';
import { FakeEmrAdapter, FakeGlueAdapter } from './fakes';

describe('EmrSessionCatalog', () => {
  const catalogs: EmrSessionCatalog[] = [];

  afterEach(() => {
    for (const catalog of catalogs) {
      catalog.dispose();
    }
    catalogs.length = 0;
  });

  function createCatalog(emr: FakeEmrAdapter, pollIntervalMs = 50_000): EmrSessionCatalog {
    const catalog = new EmrSessionCatalog(emr, { pollIntervalMs });
    catalogs.push(catalog);
    return catalog;
  }

  it('serializes concurrent refresh into one in-flight load', async () => {
    const emr = new FakeEmrAdapter();
    let listCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    emr.listApplications = async () => {
      listCalls += 1;
      await gate;
      return { region: 'us-east-1', applications: [] };
    };

    const catalog = createCatalog(emr);
    const first = catalog.refresh();
    const second = catalog.refresh();
    assert.equal(first, second);
    release();
    await first;
    assert.equal(listCalls, 1);
  });

  it('keeps previous sessions until the new snapshot is ready', async () => {
    const emr = new FakeEmrAdapter();
    emr.applications = [
      {
        id: 'app-1',
        name: 'Prod',
        state: 'STARTED',
        livyEndpointEnabled: true,
      },
    ];
    emr.sessionsByApp.set('app-1', [{ id: 1, state: 'idle' }]);

    const catalog = createCatalog(emr);
    await catalog.refresh();
    assert.equal(catalog.sessionsFor('app-1').length, 1);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalList = emr.listApplications.bind(emr);
    emr.listApplications = async (options) => {
      await gate;
      return originalList(options);
    };

    const pending = catalog.refresh();
    assert.equal(catalog.sessionsFor('app-1').length, 1);
    release();
    await pending;
    assert.equal(catalog.sessionsFor('app-1').length, 1);
  });

  it('refreshIfStale skips a second load within the stale window', async () => {
    const emr = new FakeEmrAdapter();
    let listCalls = 0;
    const originalList = emr.listApplications.bind(emr);
    emr.listApplications = async (options) => {
      listCalls += 1;
      return originalList(options);
    };

    const catalog = createCatalog(emr);
    await catalog.refresh();
    await catalog.refreshIfStale(60_000);
    assert.equal(listCalls, 1);
  });

  it('loads sessions for STARTED apps in parallel', async () => {
    const emr = new FakeEmrAdapter();
    emr.applications = [
      { id: 'a', name: 'A', state: 'STARTED', livyEndpointEnabled: true },
      { id: 'b', name: 'B', state: 'STARTED', livyEndpointEnabled: true },
      { id: 'c', name: 'C', state: 'STOPPED', livyEndpointEnabled: true },
    ];
    emr.sessionsByApp.set('a', [{ id: 1, state: 'idle' }]);
    emr.sessionsByApp.set('b', [{ id: 2, state: 'idle' }]);

    const catalog = createCatalog(emr);
    await catalog.refresh();
    assert.equal(catalog.sessionsFor('a').length, 1);
    assert.equal(catalog.sessionsFor('b').length, 1);
    assert.equal(catalog.sessionsFor('c').length, 0);
  });
});

describe('GlueSessionCatalog', () => {
  it('serializes concurrent refresh', async () => {
    const glue = new FakeGlueAdapter();
    let listCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    glue.listSessions = async () => {
      listCalls += 1;
      await gate;
      return { region: 'us-east-1', sessions: [] };
    };

    const catalog = new GlueSessionCatalog(glue, { pollIntervalMs: 50_000 });
    const first = catalog.refresh();
    const second = catalog.refresh();
    assert.equal(first, second);
    release();
    await first;
    catalog.dispose();
    assert.equal(listCalls, 1);
  });
});
