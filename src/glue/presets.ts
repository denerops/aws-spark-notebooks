import * as vscode from 'vscode';
import { getGlueExtensionConfig } from '../aws/glueConfig';
import {
  buildDefaultGluePreset,
  createGluePresetId,
  normalizeGluePreset,
  stripGlueRuntimeFields,
  type GluePresetSource,
  type GlueSessionPreset,
} from './presetModel';

export type { GlueSessionPreset, GluePresetSource } from './presetModel';
export {
  createGluePresetId,
  buildDefaultGluePreset,
  buildDefaultGlueArguments,
  normalizeGluePreset,
} from './presetModel';

const STORAGE_KEY = 'glueInteractive.sessionPresets';
export const DEFAULT_GLUE_WORKSPACE_PRESETS_FILE = '.vscode/glue-interactive-presets.json';

export interface GlueWorkspacePresetsFile {
  version: number;
  presets: GlueSessionPreset[];
}

export function getGlueWorkspacePresetsRelativePath(): string {
  return getGlueExtensionConfig().get<string>(
    'sessionPresets.workspaceFile',
    DEFAULT_GLUE_WORKSPACE_PRESETS_FILE
  );
}

export function getGlueWorkspacePresetsUri(
  folder?: vscode.WorkspaceFolder
): vscode.Uri | undefined {
  const target = folder ?? getWorkspaceFolderForGluePresets();
  if (!target) {
    return undefined;
  }
  return vscode.Uri.joinPath(target.uri, getGlueWorkspacePresetsRelativePath());
}

function getWorkspaceFolderForGluePresets(
  resource?: vscode.Uri
): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }

  if (resource) {
    const folder = vscode.workspace.getWorkspaceFolder(resource);
    if (folder) {
      return folder;
    }
  }

  const activeNotebook = vscode.window.activeNotebookEditor?.notebook.uri;
  if (activeNotebook) {
    const folder = vscode.workspace.getWorkspaceFolder(activeNotebook);
    if (folder) {
      return folder;
    }
  }

  return folders[0];
}

export async function glueWorkspacePresetsFileExists(
  folder?: vscode.WorkspaceFolder
): Promise<boolean> {
  const uri = getGlueWorkspacePresetsUri(folder);
  if (!uri) {
    return false;
  }
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function readGlueWorkspacePresets(
  folder?: vscode.WorkspaceFolder
): Promise<GlueSessionPreset[]> {
  const uri = getGlueWorkspacePresetsUri(folder);
  if (!uri) {
    return [];
  }

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(raw).toString('utf8').trim();
    if (!text) {
      return [];
    }

    const parsed = JSON.parse(text) as GlueWorkspacePresetsFile | GlueSessionPreset[];
    const presets = Array.isArray(parsed) ? parsed : (parsed.presets ?? []);
    return presets.map((preset, index) => normalizeGluePreset(preset, index));
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read workspace Glue session presets: ${message}`);
  }
}

export async function writeGlueWorkspacePresets(
  presets: GlueSessionPreset[],
  folder?: vscode.WorkspaceFolder
): Promise<void> {
  const uri = getGlueWorkspacePresetsUri(folder);
  if (!uri) {
    throw new Error('Open a workspace folder to save team Glue session presets.');
  }

  const dir = vscode.Uri.joinPath(uri, '..');
  try {
    await vscode.workspace.fs.stat(dir);
  } catch {
    await vscode.workspace.fs.createDirectory(dir);
  }

  const payload: GlueWorkspacePresetsFile = {
    version: 1,
    presets: presets.map(stripGlueRuntimeFields),
  };
  const contents = `${JSON.stringify(payload, null, 2)}\n`;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, 'utf8'));
}

export function watchGlueWorkspacePresets(onChange: () => void): vscode.Disposable {
  const pattern = getGlueWorkspacePresetsRelativePath().replace(/^\.\//, '');
  const watcher = vscode.workspace.createFileSystemWatcher(
    `**/${pattern}`,
    false,
    false,
    false
  );

  const fire = () => onChange();
  watcher.onDidCreate(fire);
  watcher.onDidChange(fire);
  watcher.onDidDelete(fire);

  return watcher;
}

export class GlueSessionPresetStore {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      watchGlueWorkspacePresets(() => this.onDidChangeEmitter.fire())
    );
  }

  private readUserPresets(): GlueSessionPreset[] {
    return this.context.globalState.get<GlueSessionPreset[]>(STORAGE_KEY) ?? [];
  }

  private async writeUserPresets(presets: GlueSessionPreset[]): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, presets);
  }

  private async readWorkspacePresetsList(): Promise<GlueSessionPreset[]> {
    try {
      return await readGlueWorkspacePresets();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
      return [];
    }
  }

  private preferWorkspaceForNewPresets(): boolean {
    return getGlueExtensionConfig().get<boolean>('sessionPresets.preferWorkspace', true);
  }

  async hasWorkspaceScope(): Promise<boolean> {
    return Boolean(getWorkspaceFolderForGluePresets());
  }

  async hasWorkspacePresetsFile(): Promise<boolean> {
    return glueWorkspacePresetsFileExists();
  }

  async list(): Promise<GlueSessionPreset[]> {
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

    const defaultPreset = { ...buildDefaultGluePreset(), source: 'user' as const };
    await this.writeUserPresets([defaultPreset]);
    return [defaultPreset];
  }

  async get(id: string): Promise<GlueSessionPreset | undefined> {
    const presets = await this.list();
    return presets.find((preset) => preset.id === id);
  }

  async getSource(id: string): Promise<GluePresetSource | undefined> {
    const preset = await this.get(id);
    return preset?.source;
  }

  async save(preset: GlueSessionPreset, source?: GluePresetSource): Promise<void> {
    const targetSource = source ?? preset.source ?? (await this.resolveDefaultSource());
    const normalized = normalizeGluePreset(preset);

    if (targetSource === 'workspace') {
      const workspacePresets = await this.readWorkspacePresetsList();
      const index = workspacePresets.findIndex((item) => item.id === normalized.id);
      if (index >= 0) {
        workspacePresets[index] = normalized;
      } else {
        workspacePresets.push(normalized);
      }
      await writeGlueWorkspacePresets(workspacePresets);
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
      throw new Error('Cannot delete the last Glue session preset.');
    }

    const source = await this.getSource(id);
    if (source === 'workspace') {
      const workspacePresets = (await this.readWorkspacePresetsList()).filter(
        (preset) => preset.id !== id
      );
      await writeGlueWorkspacePresets(workspacePresets);
    } else {
      await this.writeUserPresets(this.readUserPresets().filter((preset) => preset.id !== id));
    }

    this.onDidChangeEmitter.fire();
  }

  async exportUserPresetsToWorkspace(): Promise<number> {
    const userPresets = this.readUserPresets();
    if (userPresets.length === 0) {
      throw new Error('No personal Glue presets to export.');
    }

    const workspacePresets = await this.readWorkspacePresetsList();
    const merged = [...workspacePresets];
    let added = 0;

    for (const preset of userPresets) {
      if (merged.some((item) => item.id === preset.id)) {
        continue;
      }
      merged.push(normalizeGluePreset(preset));
      added += 1;
    }

    await writeGlueWorkspacePresets(merged);
    this.onDidChangeEmitter.fire();
    return added;
  }

  async ensureWorkspacePresetsFile(seedFromUser = true): Promise<void> {
    if (await glueWorkspacePresetsFileExists()) {
      return;
    }

    if (seedFromUser) {
      const userPresets = this.readUserPresets();
      if (userPresets.length > 0) {
        await writeGlueWorkspacePresets(userPresets.map((preset) => normalizeGluePreset(preset)));
        this.onDidChangeEmitter.fire();
        return;
      }
    }

    await writeGlueWorkspacePresets([]);
    this.onDidChangeEmitter.fire();
  }

  private async resolveDefaultSource(): Promise<GluePresetSource> {
    if (!(await this.hasWorkspaceScope())) {
      return 'user';
    }
    if (this.preferWorkspaceForNewPresets()) {
      return 'workspace';
    }
    return 'user';
  }
}

let glueStoreInstance: GlueSessionPresetStore | undefined;

export function getGlueSessionPresetStore(
  context: vscode.ExtensionContext
): GlueSessionPresetStore {
  if (!glueStoreInstance) {
    glueStoreInstance = new GlueSessionPresetStore(context);
  }
  return glueStoreInstance;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError &&
    (error.code === 'FileNotFound' || error.code === 'EntryNotFound')
  );
}
