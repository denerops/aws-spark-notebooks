import * as vscode from 'vscode';
import {
  buildDefaultPreset,
  createPresetId,
  normalizePreset,
  type SessionPreset,
  type SessionPresetSource,
} from './presetModel';
import {
  getWorkspaceFolderForPresets,
  readWorkspacePresets,
  watchWorkspacePresets,
  workspacePresetsFileExists,
  writeWorkspacePresets,
} from './workspacePresets';

export type { SessionPreset, SessionPresetSource } from './presetModel';
export { createPresetId, buildDefaultPreset, buildDefaultSparkConf, normalizePreset } from './presetModel';

const STORAGE_KEY = 'emrServerless.sessionPresets';

export class SessionPresetStore {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      watchWorkspacePresets(() => this.onDidChangeEmitter.fire())
    );
  }

  private readUserPresets(): SessionPreset[] {
    return this.context.globalState.get<SessionPreset[]>(STORAGE_KEY) ?? [];
  }

  private async writeUserPresets(presets: SessionPreset[]): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, presets);
  }

  private async readWorkspacePresetsList(): Promise<SessionPreset[]> {
    try {
      return await readWorkspacePresets();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
      return [];
    }
  }

  private preferWorkspaceForNewPresets(): boolean {
    return vscode.workspace
      .getConfiguration('emrServerless')
      .get<boolean>('sessionPresets.preferWorkspace', true);
  }

  async hasWorkspaceScope(): Promise<boolean> {
    return Boolean(getWorkspaceFolderForPresets());
  }

  async hasWorkspacePresetsFile(): Promise<boolean> {
    return workspacePresetsFileExists();
  }

  async list(): Promise<SessionPreset[]> {
    const workspacePresets = (await this.readWorkspacePresetsList()).map((preset) => ({
      ...preset,
      source: 'workspace' as const,
    }));
    const userPresets = this.readUserPresets()
      .filter((preset) => !workspacePresets.some((ws) => ws.id === preset.id))
      .map((preset) => ({
        ...preset,
        source: 'user' as const,
      }));

    const combined = [...workspacePresets, ...userPresets];
    if (combined.length > 0) {
      return combined;
    }

    const defaultPreset = { ...buildDefaultPreset(), source: 'user' as const };
    await this.writeUserPresets([defaultPreset]);
    return [defaultPreset];
  }

  async get(id: string): Promise<SessionPreset | undefined> {
    const presets = await this.list();
    return presets.find((preset) => preset.id === id);
  }

  async getSource(id: string): Promise<SessionPresetSource | undefined> {
    const preset = await this.get(id);
    return preset?.source;
  }

  async save(preset: SessionPreset, source?: SessionPresetSource): Promise<void> {
    const targetSource = source ?? preset.source ?? (await this.resolveDefaultSource());
    const normalized = normalizePreset(preset);

    if (targetSource === 'workspace') {
      const workspacePresets = await this.readWorkspacePresetsList();
      const index = workspacePresets.findIndex((item) => item.id === normalized.id);
      if (index >= 0) {
        workspacePresets[index] = normalized;
      } else {
        workspacePresets.push(normalized);
      }
      await writeWorkspacePresets(workspacePresets);
    } else {
      const userPresets = [...this.readUserPresets()];
      const index = userPresets.findIndex((item) => item.id === normalized.id);
      if (index >= 0) {
        userPresets[index] = normalized;
      } else {
        userPresets.push(normalized);
      }
      await this.writeUserPresets(userPresets);
    }

    this.onDidChangeEmitter.fire();
  }

  async delete(id: string): Promise<void> {
    const presets = await this.list();
    if (presets.length <= 1) {
      throw new Error('Cannot delete the last session preset.');
    }

    const source = await this.getSource(id);
    if (source === 'workspace') {
      const workspacePresets = (await this.readWorkspacePresetsList()).filter(
        (preset) => preset.id !== id
      );
      await writeWorkspacePresets(workspacePresets);
    } else {
      await this.writeUserPresets(this.readUserPresets().filter((preset) => preset.id !== id));
    }

    this.onDidChangeEmitter.fire();
  }

  async exportUserPresetsToWorkspace(): Promise<number> {
    const userPresets = this.readUserPresets();
    if (userPresets.length === 0) {
      throw new Error('No personal presets to export.');
    }

    const workspacePresets = await this.readWorkspacePresetsList();
    const merged = [...workspacePresets];
    let added = 0;

    for (const preset of userPresets) {
      if (merged.some((item) => item.id === preset.id)) {
        continue;
      }
      merged.push(normalizePreset(preset));
      added += 1;
    }

    await writeWorkspacePresets(merged);
    this.onDidChangeEmitter.fire();
    return added;
  }

  async ensureWorkspacePresetsFile(seedFromUser = true): Promise<void> {
    if (await workspacePresetsFileExists()) {
      return;
    }

    if (seedFromUser) {
      const userPresets = this.readUserPresets();
      if (userPresets.length > 0) {
        await writeWorkspacePresets(userPresets.map((preset) => normalizePreset(preset)));
        this.onDidChangeEmitter.fire();
        return;
      }
    }

    await writeWorkspacePresets([]);
    this.onDidChangeEmitter.fire();
  }

  private async resolveDefaultSource(): Promise<SessionPresetSource> {
    if (!(await this.hasWorkspaceScope())) {
      return 'user';
    }
    if (this.preferWorkspaceForNewPresets()) {
      return 'workspace';
    }
    return 'user';
  }
}

let storeInstance: SessionPresetStore | undefined;

export function getSessionPresetStore(context: vscode.ExtensionContext): SessionPresetStore {
  if (!storeInstance) {
    storeInstance = new SessionPresetStore(context);
  }
  return storeInstance;
}
