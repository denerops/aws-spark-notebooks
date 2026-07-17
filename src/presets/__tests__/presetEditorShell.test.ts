import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PresetStore, PresetWithSource } from '../createPresetStore';
import { PresetEditorController, type PresetEditorUi } from '../presetEditorShell';

interface TestPreset extends PresetWithSource {
  id: string;
  name: string;
}

function createFakeStore(initial: TestPreset[]): PresetStore<TestPreset> & {
  saves: Array<{ preset: TestPreset; source?: string }>;
  deletes: string[];
} {
  let presets = initial.map((p) => ({ ...p }));
  const saves: Array<{ preset: TestPreset; source?: string }> = [];
  const deletes: string[] = [];

  const store: PresetStore<TestPreset> & {
    saves: typeof saves;
    deletes: typeof deletes;
  } = {
    saves,
    deletes,
    onDidChange: () => ({ dispose() {} }),
    hasWorkspaceScope: async () => true,
    hasWorkspacePresetsFile: async () => true,
    list: async () => presets,
    get: async (id) => presets.find((p) => p.id === id),
    getSource: async (id) => presets.find((p) => p.id === id)?.source,
    save: async (preset, source) => {
      saves.push({ preset, source });
      const index = presets.findIndex((p) => p.id === preset.id);
      const next = { ...preset, source: source ?? preset.source };
      if (index >= 0) {
        presets[index] = next;
      } else {
        presets.push(next);
      }
    },
    delete: async (id) => {
      deletes.push(id);
      presets = presets.filter((p) => p.id !== id);
    },
    exportUserPresetsToWorkspace: async () => 0,
    ensureWorkspacePresetsFile: async () => {},
  };

  return store;
}

function createFakeUi(options?: {
  confirmDelete?: boolean;
}): PresetEditorUi & { errors: string[]; infos: string[] } {
  const errors: string[] = [];
  const infos: string[] = [];
  return {
    errors,
    infos,
    showErrorMessage: (message) => {
      errors.push(message);
    },
    showInformationMessage: (message) => {
      infos.push(message);
    },
    showDeleteConfirm: async () => (options?.confirmDelete === false ? undefined : 'Delete'),
  };
}

describe('PresetEditorController message protocol', () => {
  it('rejects empty name without saving', async () => {
    const store = createFakeStore([{ id: 'a', name: 'A', source: 'user' }]);
    const ui = createFakeUi();
    const controller = new PresetEditorController<TestPreset>({
      store,
      getWebview: () => ({ html: '' }),
      renderHtml: () => '<empty>',
      savedMessage: () => 'saved',
      deleteConfirmMessage: (name) => `Delete ${name}?`,
      deletedMessage: (name) => `Deleted ${name}`,
      emptyStateTitle: 'Preset',
      ui,
    });
    controller.setSelectedId('a');

    await controller.handleMessage({
      type: 'save',
      preset: { id: 'a', name: '   ' },
    });

    assert.deepEqual(ui.errors, ['Preset name is required.']);
    assert.equal(store.saves.length, 0);
  });

  it('save reaches store', async () => {
    const store = createFakeStore([{ id: 'a', name: 'A', source: 'user' }]);
    const ui = createFakeUi();
    const controller = new PresetEditorController<TestPreset>({
      store,
      getWebview: () => ({ html: '' }),
      renderHtml: () => '<html>',
      savedMessage: (preset, scope) => `Saved ${scope} ${preset.name}`,
      deleteConfirmMessage: (name) => `Delete ${name}?`,
      deletedMessage: (name) => `Deleted ${name}`,
      emptyStateTitle: 'Preset',
      ui,
    });
    controller.setSelectedId('a');

    await controller.handleMessage({
      type: 'save',
      preset: { id: 'a', name: 'Renamed' },
    });

    assert.equal(store.saves.length, 1);
    assert.equal(store.saves[0]?.preset.name, 'Renamed');
    assert.equal(store.saves[0]?.source, 'user');
    assert.deepEqual(ui.infos, ['Saved personal Renamed']);
  });

  it('cancelled delete leaves store unchanged', async () => {
    const store = createFakeStore([
      { id: 'a', name: 'A', source: 'user' },
      { id: 'b', name: 'B', source: 'user' },
    ]);
    const ui = createFakeUi({ confirmDelete: false });
    const controller = new PresetEditorController<TestPreset>({
      store,
      getWebview: () => ({ html: '' }),
      renderHtml: () => '<html>',
      savedMessage: () => 'saved',
      deleteConfirmMessage: (name) => `Delete ${name}?`,
      deletedMessage: (name) => `Deleted ${name}`,
      emptyStateTitle: 'Preset',
      ui,
    });

    await controller.handleMessage({ type: 'delete', id: 'a' });

    assert.equal(store.deletes.length, 0);
    assert.equal((await store.list()).length, 2);
    assert.deepEqual(ui.infos, []);
  });
});
