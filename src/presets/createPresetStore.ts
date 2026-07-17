import type { WorkspacePresetFileIO } from './workspaceFile';

export type PresetSource = 'workspace' | 'user';

export interface PresetWithSource {
  id: string;
  source?: PresetSource;
}

export interface Disposable {
  dispose(): void;
}

export type PresetChangeEvent = (listener: () => void) => Disposable;

export interface PresetStoreUserStorage<T> {
  get(): T[];
  set(presets: T[]): Promise<void>;
}

export interface PresetStoreConfig<T extends PresetWithSource> {
  userStorage: PresetStoreUserStorage<T>;
  getPreferWorkspace: () => boolean;
  workspace: Pick<
    WorkspacePresetFileIO<T>,
    'read' | 'write' | 'fileExists' | 'getFolder' | 'watch'
  >;
  normalize: (preset: T, index?: number) => T;
  buildDefault: () => T;
  /** Runs after normalize on every save; must throw on invalid invariants. */
  assertOnSave: (preset: T) => void;
  lastDeleteError: string;
  emptyExportError: string;
  /** Called when workspace read fails (UI shows toast). */
  onWorkspaceReadError?: (message: string) => void;
  /** Register disposables (watch subscription). No-op in unit tests. */
  addSubscription?: (disposable: Disposable) => void;
}

export interface PresetStore<T extends PresetWithSource> {
  readonly onDidChange: PresetChangeEvent;
  hasWorkspaceScope(): Promise<boolean>;
  hasWorkspacePresetsFile(): Promise<boolean>;
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  getSource(id: string): Promise<PresetSource | undefined>;
  save(preset: T, source?: PresetSource): Promise<void>;
  delete(id: string): Promise<void>;
  exportUserPresetsToWorkspace(): Promise<number>;
  ensureWorkspacePresetsFile(seedFromUser?: boolean): Promise<void>;
}

function createChangeEmitter(): {
  event: PresetChangeEvent;
  fire: () => void;
  dispose: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    fire: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    dispose: () => {
      listeners.clear();
    },
  };
}

export function createPresetStore<T extends PresetWithSource>(
  config: PresetStoreConfig<T>
): PresetStore<T> {
  const onDidChangeEmitter = createChangeEmitter();
  const watchDisposable = config.workspace.watch(() => onDidChangeEmitter.fire());
  config.addSubscription?.(watchDisposable);
  config.addSubscription?.({ dispose: () => onDidChangeEmitter.dispose() });

  function readUserPresets(): T[] {
    return config.userStorage.get();
  }

  async function writeUserPresets(presets: T[]): Promise<void> {
    await config.userStorage.set(presets);
  }

  async function readWorkspacePresetsList(): Promise<T[]> {
    try {
      return await config.workspace.read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      config.onWorkspaceReadError?.(message);
      return [];
    }
  }

  async function hasWorkspaceScope(): Promise<boolean> {
    return Boolean(config.workspace.getFolder());
  }

  async function hasWorkspacePresetsFile(): Promise<boolean> {
    return config.workspace.fileExists();
  }

  async function resolveDefaultSource(): Promise<PresetSource> {
    if (!(await hasWorkspaceScope())) {
      return 'user';
    }
    if (config.getPreferWorkspace()) {
      return 'workspace';
    }
    return 'user';
  }

  async function list(): Promise<T[]> {
    const workspacePresets = (await readWorkspacePresetsList()).map((preset) => ({
      ...preset,
      source: 'workspace' as const,
    }));
    const userPresets = readUserPresets()
      .filter((preset) => !workspacePresets.some((ws) => ws.id === preset.id))
      .map((preset) => ({
        ...preset,
        source: 'user' as const,
      }));

    const combined = [...workspacePresets, ...userPresets];
    if (combined.length > 0) {
      return combined;
    }

    const defaultPreset = { ...config.buildDefault(), source: 'user' as const };
    await writeUserPresets([defaultPreset]);
    return [defaultPreset];
  }

  async function get(id: string): Promise<T | undefined> {
    const presets = await list();
    return presets.find((preset) => preset.id === id);
  }

  async function getSource(id: string): Promise<PresetSource | undefined> {
    const preset = await get(id);
    return preset?.source;
  }

  async function save(preset: T, source?: PresetSource): Promise<void> {
    const targetSource = source ?? preset.source ?? (await resolveDefaultSource());
    const normalized = config.normalize(preset);
    config.assertOnSave(normalized);

    if (targetSource === 'workspace') {
      const workspacePresets = await readWorkspacePresetsList();
      const index = workspacePresets.findIndex((item) => item.id === normalized.id);
      if (index >= 0) {
        workspacePresets[index] = normalized;
      } else {
        workspacePresets.push(normalized);
      }
      await config.workspace.write(workspacePresets);
    } else {
      const userPresets = [...readUserPresets()];
      const index = userPresets.findIndex((item) => item.id === normalized.id);
      if (index >= 0) {
        userPresets[index] = normalized;
      } else {
        userPresets.push(normalized);
      }
      await writeUserPresets(userPresets);
    }

    onDidChangeEmitter.fire();
  }

  async function deletePreset(id: string): Promise<void> {
    const presets = await list();
    if (presets.length <= 1) {
      throw new Error(config.lastDeleteError);
    }

    const source = await getSource(id);
    if (source === 'workspace') {
      const workspacePresets = (await readWorkspacePresetsList()).filter(
        (preset) => preset.id !== id
      );
      await config.workspace.write(workspacePresets);
    } else {
      await writeUserPresets(readUserPresets().filter((preset) => preset.id !== id));
    }

    onDidChangeEmitter.fire();
  }

  async function exportUserPresetsToWorkspace(): Promise<number> {
    const userPresets = readUserPresets();
    if (userPresets.length === 0) {
      throw new Error(config.emptyExportError);
    }

    const workspacePresets = await readWorkspacePresetsList();
    const merged = [...workspacePresets];
    let added = 0;

    for (const preset of userPresets) {
      if (merged.some((item) => item.id === preset.id)) {
        continue;
      }
      const normalized = config.normalize(preset);
      config.assertOnSave(normalized);
      merged.push(normalized);
      added += 1;
    }

    await config.workspace.write(merged);
    onDidChangeEmitter.fire();
    return added;
  }

  async function ensureWorkspacePresetsFile(seedFromUser = true): Promise<void> {
    if (await config.workspace.fileExists()) {
      return;
    }

    if (seedFromUser) {
      const userPresets = readUserPresets();
      if (userPresets.length > 0) {
        const normalized = userPresets.map((preset) => {
          const next = config.normalize(preset);
          config.assertOnSave(next);
          return next;
        });
        await config.workspace.write(normalized);
        onDidChangeEmitter.fire();
        return;
      }
    }

    await config.workspace.write([]);
    onDidChangeEmitter.fire();
  }

  return {
    onDidChange: onDidChangeEmitter.event,
    hasWorkspaceScope,
    hasWorkspacePresetsFile,
    list,
    get,
    getSource,
    save,
    delete: deletePreset,
    exportUserPresetsToWorkspace,
    ensureWorkspacePresetsFile,
  };
}
