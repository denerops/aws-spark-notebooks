import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createPresetStore,
  type PresetStore,
  type PresetWithSource,
} from '../createPresetStore';
import { assertValidPythonPackageSpecs } from '../../session/pythonPackages';
import { assertValidSparkPackageSpecs } from '../../session/sparkPackages';
import { normalizePythonPackages } from '../../session/pythonPackages';
import { normalizeSparkPackages } from '../../session/sparkPackages';

interface TestPreset extends PresetWithSource {
  id: string;
  name: string;
  pythonPackages?: string[];
  sparkPackages?: string[];
}

function normalizeTestPreset(preset: TestPreset, index = 0): TestPreset {
  return {
    id: preset.id?.trim() || `preset-${index + 1}`,
    name: preset.name?.trim() || `Preset ${index + 1}`,
    pythonPackages: normalizePythonPackages(preset.pythonPackages),
    sparkPackages: normalizeSparkPackages(preset.sparkPackages),
  };
}

function assertPackages(preset: TestPreset): void {
  assertValidPythonPackageSpecs(preset.pythonPackages ?? []);
  assertValidSparkPackageSpecs(preset.sparkPackages ?? []);
}

function createMemoryWorkspace(initial: TestPreset[] = []) {
  let presets = [...initial];
  let exists = initial.length > 0;
  const folder = { name: 'ws' } as const;

  return {
    io: {
      getRelativePath: () => '.vscode/test-presets.json',
      getUri: () => undefined,
      getFolder: () => folder as never,
      fileExists: async () => exists,
      read: async () => presets.map((p, i) => normalizeTestPreset(p, i)),
      write: async (next: TestPreset[]) => {
        presets = next.map((p, i) => normalizeTestPreset(p, i));
        exists = true;
      },
      watch: () => ({ dispose() {} }),
    },
    getPresets: () => presets,
    setExists: (value: boolean) => {
      exists = value;
    },
  };
}

function createMemoryUserStorage(initial: TestPreset[] = []) {
  let presets = [...initial];
  return {
    get: () => presets,
    set: async (next: TestPreset[]) => {
      presets = next;
    },
    snapshot: () => presets,
  };
}

function createTestStore(options?: {
  user?: TestPreset[];
  workspace?: TestPreset[];
  preferWorkspace?: boolean;
}): {
  store: PresetStore<TestPreset>;
  user: ReturnType<typeof createMemoryUserStorage>;
  workspace: ReturnType<typeof createMemoryWorkspace>;
} {
  const user = createMemoryUserStorage(options?.user ?? []);
  const workspace = createMemoryWorkspace(options?.workspace ?? []);
  const store = createPresetStore<TestPreset>({
    userStorage: user,
    getPreferWorkspace: () => options?.preferWorkspace ?? true,
    workspace: workspace.io,
    normalize: normalizeTestPreset,
    buildDefault: () => ({ id: 'default', name: 'Default', pythonPackages: [], sparkPackages: [] }),
    assertOnSave: assertPackages,
    lastDeleteError: 'Cannot delete the last session preset.',
    emptyExportError: 'No personal presets to export.',
  });
  return { store, user, workspace };
}

describe('createPresetStore policy', () => {
  it('list merge: workspace wins on id collision', async () => {
    const { store } = createTestStore({
      user: [{ id: 'shared', name: 'User copy', pythonPackages: ['pandas'] }],
      workspace: [{ id: 'shared', name: 'Workspace copy', pythonPackages: ['numpy'] }],
    });

    const listed = await store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.name, 'Workspace copy');
    assert.equal(listed[0]?.source, 'workspace');
    assert.deepEqual(listed[0]?.pythonPackages, ['numpy']);
  });

  it('list includes user-only presets when no collision', async () => {
    const { store } = createTestStore({
      user: [{ id: 'user-1', name: 'Personal' }],
      workspace: [{ id: 'ws-1', name: 'Team' }],
    });

    const listed = await store.list();
    assert.equal(listed.length, 2);
    assert.equal(listed.find((p) => p.id === 'ws-1')?.source, 'workspace');
    assert.equal(listed.find((p) => p.id === 'user-1')?.source, 'user');
  });

  it('save rejects invalid package specs', async () => {
    const { store, user } = createTestStore({
      user: [{ id: 'a', name: 'A' }],
    });

    await assert.rejects(
      () =>
        store.save(
          { id: 'a', name: 'A', pythonPackages: ['bad;rm -rf'] },
          'user'
        ),
      /Invalid Python package/
    );
    assert.equal(user.snapshot()[0]?.pythonPackages, undefined);

    await assert.rejects(
      () =>
        store.save(
          { id: 'a', name: 'A', sparkPackages: ['org.foo:bar:1,evil'] },
          'user'
        ),
      /Invalid Spark package/
    );
  });

  it('save persists normalized packages', async () => {
    const { store, user } = createTestStore({
      user: [{ id: 'a', name: 'A' }],
    });

    await store.save(
      {
        id: 'a',
        name: 'A',
        pythonPackages: ['  pandas  ', 'pandas', 'numpy'],
        sparkPackages: [' org.apache:x:1 '],
      },
      'user'
    );

    const saved = user.snapshot().find((p) => p.id === 'a');
    assert.deepEqual(saved?.pythonPackages, ['pandas', 'numpy']);
    assert.deepEqual(saved?.sparkPackages, ['org.apache:x:1']);
  });

  it('delete last preset throws', async () => {
    const { store } = createTestStore({
      user: [{ id: 'only', name: 'Only' }],
    });

    await assert.rejects(() => store.delete('only'), /Cannot delete the last session preset/);
  });

  it('export skips ids already in workspace', async () => {
    const { store, workspace } = createTestStore({
      user: [
        { id: 'shared', name: 'User shared' },
        { id: 'new', name: 'New personal' },
      ],
      workspace: [{ id: 'shared', name: 'Workspace shared' }],
    });

    const added = await store.exportUserPresetsToWorkspace();
    assert.equal(added, 1);
    assert.equal(workspace.getPresets().length, 2);
    assert.ok(workspace.getPresets().some((p) => p.id === 'new'));
  });
});
