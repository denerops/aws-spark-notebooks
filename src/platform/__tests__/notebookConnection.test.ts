import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotebookConnection } from '../notebookConnection';
import type { NotebookRef, NotebookWorkspace } from '../notebookWorkspace';
import { createHandle, FakeEmrAdapter, FakeGlueAdapter } from './fakes';

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

describe('NotebookConnection live binding policy', () => {
  it('keeps Session Binding on transient refresh errors', async () => {
    const emr = new FakeEmrAdapter();
    emr.attach = async (applicationId, sessionId) => {
      const handle = createHandle({
        backend: 'emr',
        sessionId,
        applicationId,
      });
      handle.refreshState = async () => {
        throw new Error('Livy API error (503): unavailable');
      };
      return handle;
    };
    const notebook = createNotebook('file:///transient.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, new FakeGlueAdapter(), workspace);

    await connection.attach(notebook, {
      backend: 'emr',
      applicationId: 'app-1',
      sessionId: 3,
    });
    const session = await connection.ensureConnected(notebook);
    assert.equal(session.sessionId, 3);
    assert.equal(notebook.metadata.emrServerless?.sessionId, 3);
    assert.equal(connection.isConnected(notebook), true);
  });

  it('clears Session Binding when refresh reports the session is gone', async () => {
    const emr = new FakeEmrAdapter();
    emr.attach = async (applicationId, sessionId) => {
      const handle = createHandle({
        backend: 'emr',
        sessionId,
        applicationId,
      });
      handle.refreshState = async () => {
        throw new Error('Livy API error (404): Session not found');
      };
      return handle;
    };
    const notebook = createNotebook('file:///gone.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, new FakeGlueAdapter(), workspace);

    await connection.attach(notebook, {
      backend: 'emr',
      applicationId: 'app-1',
      sessionId: 9,
    });
    await assert.rejects(() => connection.ensureConnected(notebook), /not connected/);
    assert.equal(notebook.metadata.emrServerless?.sessionId, undefined);
    assert.equal(connection.hasSessionBinding(notebook), false);
  });

  it('waits for a starting session instead of wiping the binding', async () => {
    const emr = new FakeEmrAdapter();
    emr.attach = async (applicationId, sessionId) => {
      const handle = createHandle({
        backend: 'emr',
        sessionId,
        applicationId,
        state: 'starting',
        isReady: false,
      });
      handle.refreshState = async () => {
        /* stay starting */
      };
      handle.waitUntilReady = async () => {
        handle.state = 'idle';
        handle.isReady = true;
      };
      return handle;
    };
    const notebook = createNotebook('file:///starting.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, new FakeGlueAdapter(), workspace);

    await connection.attach(notebook, {
      backend: 'emr',
      applicationId: 'app-1',
      sessionId: 4,
    });
    const session = await connection.ensureConnected(notebook);
    assert.equal(session.isReady, true);
    assert.equal(notebook.metadata.emrServerless?.sessionId, 4);
  });

  it('disconnectAll clears notebook metadata', async () => {
    const notebook = createNotebook('file:///aws.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(
      new FakeEmrAdapter(),
      new FakeGlueAdapter(),
      workspace
    );

    await connection.attach(notebook, {
      backend: 'emr',
      applicationId: 'app-1',
      sessionId: 2,
    });
    await connection.disconnectAll();
    assert.deepEqual(notebook.metadata.emrServerless, {});
    assert.equal(connection.hasSessionBinding(notebook), false);
    assert.equal(connection.isConnected(notebook), false);
  });

  it('createForNotebook does not reuse a live session on the same application', async () => {
    const emr = new FakeEmrAdapter();
    const notebook = createNotebook('file:///create.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, new FakeGlueAdapter(), workspace);

    await connection.attach(notebook, {
      backend: 'emr',
      applicationId: 'app-1',
      sessionId: 1,
    });
    const created = await connection.createForNotebook(notebook, {
      backend: 'emr',
      applicationId: 'app-1',
      sessionName: 'next',
    });
    assert.equal(emr.createCalls.length, 1);
    assert.notEqual(created.sessionId, 1);
    assert.equal(notebook.metadata.emrServerless?.sessionId, created.sessionId);
  });

  it('serializes concurrent attach calls on the same notebook', async () => {
    const emr = new FakeEmrAdapter();
    const notebook = createNotebook('file:///lock.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(emr, new FakeGlueAdapter(), workspace);

    await Promise.all([
      connection.attach(notebook, { backend: 'emr', applicationId: 'app-1', sessionId: 1 }),
      connection.attach(notebook, { backend: 'emr', applicationId: 'app-1', sessionId: 2 }),
    ]);
    assert.equal(emr.attachCalls.length, 2);
    assert.equal(notebook.metadata.emrServerless?.sessionId, 2);
    assert.equal(connection.getSession(notebook)?.sessionId, 2);
  });

  it('emits onDidChangeConnection after bind and disconnect', async () => {
    const notebook = createNotebook('file:///events.ipynb');
    const workspace = createMemoryWorkspace([notebook]);
    const connection = new NotebookConnection(
      new FakeEmrAdapter(),
      new FakeGlueAdapter(),
      workspace
    );
    const events: string[] = [];
    connection.onDidChangeConnection((nb) => {
      events.push(nb.uri.toString());
    });

    await connection.attach(notebook, {
      backend: 'emr',
      applicationId: 'app-1',
      sessionId: 1,
    });
    await connection.disconnect(notebook);
    assert.deepEqual(events, ['file:///events.ipynb', 'file:///events.ipynb']);
  });
});
