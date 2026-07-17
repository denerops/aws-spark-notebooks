import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotebookConnection } from '../notebookConnection';
import type { NotebookRef, NotebookWorkspace } from '../notebookWorkspace';
import { FakeEmrAdapter, FakeGlueAdapter } from './fakes';

function createNotebook(
  uri: string,
  metadata: NotebookRef['metadata'] = {}
): NotebookRef {
  return {
    uri: { toString: () => uri },
    notebookType: 'emr-spark',
    metadata: { ...metadata },
  };
}

function createMemoryWorkspace(notebooks: NotebookRef[] = []): NotebookWorkspace & {
  notebooks: NotebookRef[];
  active?: NotebookRef;
} {
  const store = {
    notebooks,
    active: undefined as NotebookRef | undefined,
    async applyMetadata(notebook: NotebookRef, metadata: NotebookRef['metadata']) {
      notebook.metadata = { ...metadata };
    },
    listSparkNotebooks() {
      return store.notebooks;
    },
    getActiveSparkNotebook() {
      return store.active;
    },
  };
  return store;
}

describe('NotebookConnection policy', () => {
  it('isConnected means live+ready; hasSessionBinding means reconnectable', async () => {
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    const notebook = createNotebook('file:///nb1.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, glue, workspace);

    assert.equal(connection.isConnected(notebook), false);
    assert.equal(connection.hasSessionBinding(notebook), false);

    notebook.metadata.emrServerless = { applicationId: 'app-1', sessionId: 7 };
    assert.equal(connection.isConnected(notebook), false);
    assert.equal(connection.hasSessionBinding(notebook), true);

    await connection.ensureConnected(notebook);
    assert.equal(connection.isConnected(notebook), true);
    assert.equal(connection.hasSessionBinding(notebook), true);
    assert.deepEqual(emr.attachCalls, [{ applicationId: 'app-1', sessionId: 7 }]);
  });

  it('Session Binding mutex: attaching one backend clears the other', async () => {
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    const notebook = createNotebook('file:///nb2.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, glue, workspace);

    await connection.attach(notebook, {
      backend: 'emr',
      applicationId: 'app-1',
      sessionId: 1,
    });
    assert.equal(notebook.metadata.emrServerless?.sessionId, 1);
    assert.deepEqual(notebook.metadata.glueInteractive, {});

    await connection.attach(notebook, { backend: 'glue', sessionId: 'gs-1' });
    assert.equal(notebook.metadata.glueInteractive?.sessionId, 'gs-1');
    assert.deepEqual(notebook.metadata.emrServerless, {});
    assert.equal(connection.resolveBackend(notebook), 'glue');
    assert.equal(connection.isConnected(notebook), true);
  });

  it('createForNotebook uses discriminated backend params', async () => {
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    const notebook = createNotebook('file:///nb3.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, glue, workspace);

    const session = await connection.createForNotebook(notebook, {
      backend: 'emr',
      applicationId: 'app-9',
      sessionName: 'demo',
    });

    assert.equal(session.backend, 'emr');
    assert.equal(session.applicationId, 'app-9');
    assert.equal(connection.getConnectionView(notebook).connected, true);
    assert.equal(emr.createCalls.length, 1);
    assert.equal(glue.createCalls.length, 0);
  });
});

describe('Connection View', () => {
  it('reports connected live session and attached metadata-only binding', async () => {
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    const notebook = createNotebook('file:///view.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, glue, workspace);

    assert.deepEqual(connection.getConnectionView(notebook), {
      label: 'AWS Spark PySpark',
      description: 'No session selected',
      detail: 'Select an EMR or Glue session to run cells',
      connected: false,
    });

    notebook.metadata.glueInteractive = { sessionId: 'meta-glue' };
    const attached = connection.getConnectionView(notebook);
    assert.equal(attached.backend, 'glue');
    assert.equal(attached.connected, false);
    assert.equal(attached.detail, 'attached');
    assert.match(attached.description, /meta-glue/);

    await connection.attach(notebook, { backend: 'glue', sessionId: 'live-glue' });
    const live = connection.getConnectionView(notebook);
    assert.equal(live.connected, true);
    assert.equal(live.label, 'Glue Interactive PySpark');
    assert.equal(live.detail, 'idle');
  });
});

describe('Spark UI target', () => {
  it('prefers live binding, then metadata, then any binding', async () => {
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    glue.dashboardUrls.set('gs-live', 'https://glue.example/gs-live');

    const notebook = createNotebook('file:///ui.ipynb', {
      emrServerless: { applicationId: 'app-meta', sessionId: 42 },
    });
    const workspace = createMemoryWorkspace([notebook]);
    workspace.active = notebook;
    const connection = new NotebookConnection(emr, glue, workspace);

    const fromMeta = connection.resolveSparkUiTarget(notebook);
    assert.deepEqual(fromMeta, {
      backend: 'emr',
      applicationId: 'app-meta',
      sessionId: 42,
      session: undefined,
    });

    await connection.attach(notebook, { backend: 'glue', sessionId: 'gs-live' });
    const fromLive = connection.resolveSparkUiTarget(notebook);
    assert.equal(fromLive?.backend, 'glue');
    if (fromLive?.backend === 'glue') {
      assert.equal(fromLive.sessionId, 'gs-live');
      assert.equal(fromLive.session?.dashboardUrl, 'https://glue.example/gs-live');
    }

    const url = await connection.openSparkUi(notebook);
    assert.equal(url, 'https://glue.example/gs-live');
  });

  it('resolves unbound EMR dashboard via adapter', async () => {
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    emr.dashboardUrls.set('app-x:9', 'https://emr.example/app-x/9');

    const notebook = createNotebook('file:///ui2.ipynb', {
      emrServerless: { applicationId: 'app-x', sessionId: 9 },
    });
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, glue, workspace);

    const url = await connection.openSparkUi(notebook);
    assert.equal(url, 'https://emr.example/app-x/9');
  });
});
