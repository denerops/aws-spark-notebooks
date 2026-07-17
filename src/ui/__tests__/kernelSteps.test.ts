import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SessionPreset } from '../../session/presets';
import type { GlueSessionPreset } from '../../glue/presets';
import { FakeEmrAdapter, FakeGlueAdapter } from '../../platform/__tests__/fakes';
import { EmrKernelSteps } from '../emrKernelSteps';
import { GlueKernelSteps } from '../glueKernelSteps';
import { FakeWizardUi } from './fakeWizardUi';

const emrPreset: SessionPreset = {
  id: 'emr-default',
  name: 'EMR Default',
  livySessionName: 'dev',
  executionRoleArn: 'arn:aws:iam::1:role/emr',
  driverMemory: '4G',
  executorMemory: '4G',
  executorCores: 2,
  numExecutors: 2,
  sparkConf: {},
};

const gluePreset: GlueSessionPreset = {
  id: 'glue-default',
  name: 'Glue Default',
  sessionDescription: 'explore',
  roleArn: 'arn:aws:iam::1:role/glue',
  glueVersion: '4.0',
  workerType: 'G.1X',
  numberOfWorkers: 5,
  defaultArguments: {},
};

describe('EmrKernelSteps DTO mapping', () => {
  it('maps started apps and sessions to attach targets', async () => {
    const emr = new FakeEmrAdapter();
    emr.region = 'us-west-2';
    emr.applications = [
      {
        id: 'app-stopped',
        name: 'Stopped',
        state: 'STOPPED',
        livyEndpointEnabled: true,
      },
      {
        id: 'app-1',
        name: 'Prod',
        state: 'STARTED',
        releaseLabel: 'emr-7.0.0',
        livyEndpointEnabled: true,
      },
    ];
    emr.sessionsByApp.set('app-1', [
      { id: 9, name: 'analytics', state: 'idle', kind: 'pyspark' },
    ]);

    const ui = new FakeWizardUi();
    ui.enqueueQuickPick((items) => items.find((i) => i.label === 'Prod'));

    const steps = new EmrKernelSteps(emr, {} as never, ui, {
      pickPreset: async () => undefined,
      promptName: async () => undefined,
    });
    const result = await steps.listAttachTargets();

    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') {
      return;
    }
    assert.equal(result.title, 'Select session — Prod');
    assert.equal(result.targets.length, 1);
    assert.deepEqual(result.targets[0], {
      label: 'analytics',
      description: '#9 · idle',
      detail: 'pyspark',
      attach: { backend: 'emr', applicationId: 'app-1', sessionId: 9 },
    });
    assert.deepEqual(steps.creatingQuery(), {
      backend: 'emr',
      applicationId: 'app-1',
    });
  });

  it('returns empty when no STARTED applications', async () => {
    const emr = new FakeEmrAdapter();
    emr.applications = [
      {
        id: 'app-1',
        name: 'Stopped',
        state: 'STOPPED',
        livyEndpointEnabled: true,
      },
    ];
    const ui = new FakeWizardUi();
    const steps = new EmrKernelSteps(emr, {} as never, ui, {
      pickPreset: async () => undefined,
      promptName: async () => undefined,
    });

    const result = await steps.listAttachTargets();
    assert.equal(result.status, 'empty');
  });

  it('builds EMR create params with progress hooks', async () => {
    const emr = new FakeEmrAdapter();
    emr.applications = [
      {
        id: 'app-1',
        name: 'Prod',
        state: 'STARTED',
        livyEndpointEnabled: true,
      },
    ];
    const ui = new FakeWizardUi();
    ui.enqueueQuickPick((items) => items[0]);

    const steps = new EmrKernelSteps(emr, {} as never, ui, {
      pickPreset: async () => emrPreset,
      promptName: async () => 'my-session',
    });
    await steps.listAttachTargets();
    const params = await steps.pickCreateParams();

    assert.ok(params);
    assert.equal(params?.backend, 'emr');
    if (params?.backend !== 'emr') {
      return;
    }
    assert.equal(params.applicationId, 'app-1');
    assert.equal(params.sessionName, 'my-session');
    assert.equal(params.preset?.id, 'emr-default');
    assert.equal(typeof params.onProgress, 'function');
    assert.deepEqual(ui.commands[0], {
      command: 'emrServerless.markSessionCreating',
      args: ['app-1', 'my-session'],
    });

    params.onProgress?.({ id: 3, state: 'starting' });
    assert.deepEqual(ui.commands[1], {
      command: 'emrServerless.patchSessionProgress',
      args: ['app-1', { id: 3, state: 'starting' }],
    });
  });
});

describe('GlueKernelSteps DTO mapping', () => {
  it('maps only READY sessions to attach targets', async () => {
    const glue = new FakeGlueAdapter();
    glue.region = 'eu-west-1';
    glue.sessions = [
      {
        id: 'ready-1',
        description: 'live',
        status: 'READY',
        workerType: 'G.2X',
        numberOfWorkers: 10,
      },
      {
        id: 'prov-1',
        status: 'PROVISIONING',
        workerType: 'G.1X',
        numberOfWorkers: 2,
      },
    ];

    const ui = new FakeWizardUi();
    const steps = new GlueKernelSteps(glue, {} as never, ui, {
      pickPreset: async () => undefined,
      promptName: async () => undefined,
    });
    const result = await steps.listAttachTargets();

    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') {
      return;
    }
    assert.equal(result.title, 'Select Glue session (eu-west-1)');
    assert.equal(result.targets.length, 1);
    assert.deepEqual(result.targets[0], {
      label: 'live',
      description: 'ready-1 · READY',
      detail: 'G.2X · 10 workers',
      attach: { backend: 'glue', sessionId: 'ready-1' },
    });
  });

  it('builds Glue create params with optional description', async () => {
    const glue = new FakeGlueAdapter();
    const ui = new FakeWizardUi();
    const steps = new GlueKernelSteps(glue, {} as never, ui, {
      pickPreset: async () => gluePreset,
      promptName: async () => null as string | null | undefined,
    });

    const params = await steps.pickCreateParams();
    assert.deepEqual(params, {
      backend: 'glue',
      preset: gluePreset,
      sessionName: undefined,
    });
  });
});
