import * as vscode from 'vscode';
import { getExtensionConfig } from '../aws/config';
import {
  normalizePreset,
  stripRuntimeFields,
  type SessionPreset,
} from './presetModel';

export const DEFAULT_WORKSPACE_PRESETS_FILE = '.vscode/emr-serverless-presets.json';

export interface WorkspacePresetsFile {
  version: number;
  presets: SessionPreset[];
}

export function getWorkspacePresetsRelativePath(): string {
  return getExtensionConfig().get<string>(
    'sessionPresets.workspaceFile',
    DEFAULT_WORKSPACE_PRESETS_FILE
  );
}

export function getWorkspaceFolderForPresets(
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

export function getWorkspacePresetsUri(
  folder?: vscode.WorkspaceFolder
): vscode.Uri | undefined {
  const target = folder ?? getWorkspaceFolderForPresets();
  if (!target) {
    return undefined;
  }
  return vscode.Uri.joinPath(target.uri, getWorkspacePresetsRelativePath());
}

export async function workspacePresetsFileExists(
  folder?: vscode.WorkspaceFolder
): Promise<boolean> {
  const uri = getWorkspacePresetsUri(folder);
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

export async function readWorkspacePresets(
  folder?: vscode.WorkspaceFolder
): Promise<SessionPreset[]> {
  const uri = getWorkspacePresetsUri(folder);
  if (!uri) {
    return [];
  }

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(raw).toString('utf8').trim();
    if (!text) {
      return [];
    }

    const parsed = JSON.parse(text) as WorkspacePresetsFile | SessionPreset[];
    const presets = Array.isArray(parsed) ? parsed : (parsed.presets ?? []);
    return presets.map((preset, index) => normalizePreset(preset, index));
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read workspace session presets: ${message}`);
  }
}

export async function writeWorkspacePresets(
  presets: SessionPreset[],
  folder?: vscode.WorkspaceFolder
): Promise<void> {
  const uri = getWorkspacePresetsUri(folder);
  if (!uri) {
    throw new Error('Open a workspace folder to save team session presets.');
  }

  const dir = vscode.Uri.joinPath(uri, '..');
  try {
    await vscode.workspace.fs.stat(dir);
  } catch {
    await vscode.workspace.fs.createDirectory(dir);
  }

  const payload: WorkspacePresetsFile = {
    version: 1,
    presets: presets.map(stripRuntimeFields),
  };
  const contents = `${JSON.stringify(payload, null, 2)}\n`;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, 'utf8'));
}

export function watchWorkspacePresets(onChange: () => void): vscode.Disposable {
  const pattern = getWorkspacePresetsRelativePath().replace(/^\.\//, '');
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

function isNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError &&
    (error.code === 'FileNotFound' || error.code === 'EntryNotFound')
  );
}
