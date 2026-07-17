import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { NotebookConnection } from '../../platform/notebookConnection';
import type { NotebookRef, NotebookWorkspace } from '../../platform/notebookWorkspace';
import type { AttachParams, CreateForNotebookParams } from '../../platform/sparkBackend';
import { FakeEmrAdapter, FakeGlueAdapter } from '../../platform/__tests__/fakes';
import type {
  AttachTarget,
  KernelSelectionSteps,
  ListAttachTargetsResult,
} from '../kernelSelectionSteps';
import {
  resetSelectKernelPromptLockForTests,
  selectKernel,
} from '../selectKernel';
import { FakeWizardUi } from './fakeWizardUi';

function createNotebook(uri = 'file:///nb.ipynb'): NotebookRef {
  return {
    uri: { toString: () => uri },
    notebookType: 'emr-spark',
    metadata: {},
  };
}

function createWorkspace(notebook: NotebookRef): NotebookWorkspace {
  return {
    async applyMetadata(nb, metadata) {
      nb.metadata = { ...metadata };
    },
    listSparkNotebooks() {
      return [notebook];
    },
    getActiveSparkNotebook() {
      return notebook;
    },
  };
}

function createFakeSteps(init: {
  listResult: ListAttachTargetsResult;
  createParams?: CreateForNotebookParams;
  creating?: boolean;
}): KernelSelectionSteps & {
  listCalls: number;
  createCalls: number;
  afterCreate: boolean[];
} {
  const steps = {
    listCalls: 0,
    createCalls: 0,
    afterCreate: [] as boolean[],
    alreadyCreatingMessage: 'already creating',
    createPickLabel: '$(add) Create',
    createPickDescription: 'create',
    createPickDetail: 'preset',
    sparkUiCommand: 'test.openSparkUi',
    listAttachTargets: async () => {
      steps.listCalls += 1;
      return init.listResult;
    },
    pickCreateParams: async () => {
      steps.createCalls += 1;
      return init.createParams;
    },
    creatingQuery: () =>
      init.createParams?.backend === 'emr'
        ? { backend: 'emr' as const, applicationId: init.createParams.applicationId }
        : { backend: 'glue' as const },
    formatCreateProgressTitle: () => 'Creating…',
    formatCreateSuccessMessage: () => 'Created',
    afterCreateAttempt(succeeded: boolean) {
      steps.afterCreate.push(succeeded);
    },
  };
  return steps;
}

describe('selectKernel shell', () => {
  afterEach(() => {
    resetSelectKernelPromptLockForTests();
  });

  it('skips backend picker when backend is forced', async () => {
    const ui = new FakeWizardUi();
    const target: AttachTarget = {
      label: 's1',
      description: 'ready',
      attach: { backend: 'glue', sessionId: 'g-1' },
    };
    const glueSteps = createFakeSteps({
      listResult: {
        status: 'ready',
        title: 'Glue',
        placeHolder: 'pick',
        targets: [target],
      },
    });
    const emrSteps = createFakeSteps({
      listResult: { status: 'cancelled' },
    });

    ui.enqueueQuickPick((items) => items.find((i) => i.label === 's1'));

    const notebook = createNotebook();
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    const connection = new NotebookConnection(emr, glue, createWorkspace(notebook));

    const ok = await selectKernel(
      connection,
      { emr: emrSteps, glue: glueSteps },
      notebook,
      { backend: 'glue', ui }
    );

    assert.equal(ok, true);
    assert.equal(glueSteps.listCalls, 1);
    assert.equal(emrSteps.listCalls, 0);
    assert.equal(ui.quickPickCalls.length, 1);
    assert.deepEqual(glue.attachCalls, ['g-1']);
  });

  it('picks backend then attaches', async () => {
    const ui = new FakeWizardUi();
    const target: AttachTarget = {
      label: 'Session 1',
      description: '#1',
      attach: { backend: 'emr', applicationId: 'app-1', sessionId: 1 },
    };
    const emrSteps = createFakeSteps({
      listResult: {
        status: 'ready',
        title: 'EMR',
        placeHolder: 'pick',
        targets: [target],
      },
    });
    const glueSteps = createFakeSteps({ listResult: { status: 'cancelled' } });

    ui.enqueueQuickPick(
      (items) => items.find((i) => (i as { backend?: string }).backend === 'emr'),
      (items) => items.find((i) => i.label === 'Session 1')
    );

    const notebook = createNotebook();
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    const connection = new NotebookConnection(emr, glue, createWorkspace(notebook));

    const ok = await selectKernel(
      connection,
      { emr: emrSteps, glue: glueSteps },
      notebook,
      { ui }
    );

    assert.equal(ok, true);
    assert.deepEqual(emr.attachCalls, [{ applicationId: 'app-1', sessionId: 1 }]);
    assert.match(ui.infos[0] ?? '', /Attached to Session 1/);
  });

  it('cancels when backend picker is dismissed', async () => {
    const ui = new FakeWizardUi();
    ui.enqueueQuickPick(undefined);
    const emrSteps = createFakeSteps({ listResult: { status: 'cancelled' } });
    const glueSteps = createFakeSteps({ listResult: { status: 'cancelled' } });
    const notebook = createNotebook();
    const connection = new NotebookConnection(
      new FakeEmrAdapter(),
      new FakeGlueAdapter(),
      createWorkspace(notebook)
    );

    const ok = await selectKernel(
      connection,
      { emr: emrSteps, glue: glueSteps },
      notebook,
      { ui }
    );

    assert.equal(ok, false);
    assert.equal(emrSteps.listCalls, 0);
  });

  it('creates via steps and reports success', async () => {
    const ui = new FakeWizardUi();
    const createParams: CreateForNotebookParams = {
      backend: 'glue',
      sessionName: 'desc',
      preset: {
        id: 'p1',
        name: 'Glue Default',
        roleArn: 'arn:aws:iam::1:role/r',
        glueVersion: '4.0',
        workerType: 'G.1X',
        numberOfWorkers: 2,
        defaultArguments: {},
      },
    };
    const glueSteps = createFakeSteps({
      listResult: {
        status: 'ready',
        title: 'Glue',
        placeHolder: 'pick',
        targets: [],
      },
      createParams,
    });
    const emrSteps = createFakeSteps({ listResult: { status: 'cancelled' } });

    ui.enqueueQuickPick((items) => items.find((i) => i.label === '$(add) Create'));

    const notebook = createNotebook();
    const emr = new FakeEmrAdapter();
    const glue = new FakeGlueAdapter();
    const connection = new NotebookConnection(emr, glue, createWorkspace(notebook));

    const ok = await selectKernel(
      connection,
      { emr: emrSteps, glue: glueSteps },
      notebook,
      { backend: 'glue', ui }
    );

    assert.equal(ok, true);
    assert.equal(glueSteps.createCalls, 1);
    assert.deepEqual(glueSteps.afterCreate, [true]);
    assert.equal(glue.createCalls.length, 1);
    assert.equal(ui.infos[0], 'Created');
  });

  it('blocks double prompt for the same notebook', async () => {
    const ui = new FakeWizardUi();
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });

    const glueSteps: KernelSelectionSteps = {
      alreadyCreatingMessage: 'x',
      createPickLabel: 'c',
      createPickDescription: 'c',
      createPickDetail: 'c',
      sparkUiCommand: 'x',
      async listAttachTargets() {
        await listGate;
        return { status: 'cancelled' };
      },
      async pickCreateParams() {
        return undefined;
      },
      creatingQuery: () => ({ backend: 'glue' }),
      formatCreateProgressTitle: () => '',
      formatCreateSuccessMessage: () => '',
    };
    const emrSteps = createFakeSteps({ listResult: { status: 'cancelled' } });
    const notebook = createNotebook('file:///lock.ipynb');
    const connection = new NotebookConnection(
      new FakeEmrAdapter(),
      new FakeGlueAdapter(),
      createWorkspace(notebook)
    );

    const first = selectKernel(
      connection,
      { emr: emrSteps, glue: glueSteps },
      notebook,
      { backend: 'glue', ui }
    );
    const second = await selectKernel(
      connection,
      { emr: emrSteps, glue: glueSteps },
      notebook,
      { backend: 'glue', ui }
    );
    releaseList();
    assert.equal(await first, false);
    assert.equal(second, false);
  });

  it('surfaces list errors and empty states', async () => {
    const ui = new FakeWizardUi();
    const glueSteps = createFakeSteps({
      listResult: { status: 'error', message: 'boom' },
    });
    const emrSteps = createFakeSteps({
      listResult: { status: 'empty', message: 'no apps' },
    });
    const notebook = createNotebook();
    const connection = new NotebookConnection(
      new FakeEmrAdapter(),
      new FakeGlueAdapter(),
      createWorkspace(notebook)
    );

    assert.equal(
      await selectKernel(
        connection,
        { emr: emrSteps, glue: glueSteps },
        notebook,
        { backend: 'glue', ui }
      ),
      false
    );
    assert.deepEqual(ui.errors, ['boom']);

    resetSelectKernelPromptLockForTests();
    assert.equal(
      await selectKernel(
        connection,
        { emr: emrSteps, glue: glueSteps },
        notebook,
        { backend: 'emr', ui }
      ),
      false
    );
    assert.deepEqual(ui.warnings, ['no apps']);
  });

  it('maps already-being-created errors to info', async () => {
    const ui = new FakeWizardUi();
    const target: AttachTarget = {
      label: 's',
      description: 'd',
      attach: { backend: 'glue', sessionId: 'g-1' } satisfies AttachParams,
    };
    const glueSteps = createFakeSteps({
      listResult: {
        status: 'ready',
        title: 't',
        placeHolder: 'p',
        targets: [target],
      },
    });
    const emrSteps = createFakeSteps({ listResult: { status: 'cancelled' } });
    ui.enqueueQuickPick((items) => items[0]);

    const notebook = createNotebook();
    const glue = new FakeGlueAdapter();
    glue.attach = async () => {
      throw new Error('A Glue session is already being created. Please wait.');
    };
    const connection = new NotebookConnection(
      new FakeEmrAdapter(),
      glue,
      createWorkspace(notebook)
    );

    const ok = await selectKernel(
      connection,
      { emr: emrSteps, glue: glueSteps },
      notebook,
      { backend: 'glue', ui }
    );

    assert.equal(ok, false);
    assert.match(ui.infos[0] ?? '', /already being created/);
    assert.equal(ui.errors.length, 0);
  });
});
