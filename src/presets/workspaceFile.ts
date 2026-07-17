import * as vscode from 'vscode';

export interface WorkspacePresetsFilePayload<T> {
  version: number;
  presets: T[];
}

export interface WorkspacePresetFileConfig<T> {
  getRelativePath: () => string;
  normalize: (preset: T, index: number) => T;
  stripRuntime: (preset: T) => T;
  /** Short label for error messages, e.g. "session presets" or "Glue session presets". */
  label: string;
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

export function createWorkspacePresetFileIO<T>(config: WorkspacePresetFileConfig<T>) {
  function getUri(folder?: vscode.WorkspaceFolder): vscode.Uri | undefined {
    const target = folder ?? getWorkspaceFolderForPresets();
    if (!target) {
      return undefined;
    }
    return vscode.Uri.joinPath(target.uri, config.getRelativePath());
  }

  async function fileExists(folder?: vscode.WorkspaceFolder): Promise<boolean> {
    const uri = getUri(folder);
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

  async function read(folder?: vscode.WorkspaceFolder): Promise<T[]> {
    const uri = getUri(folder);
    if (!uri) {
      return [];
    }

    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(raw).toString('utf8').trim();
      if (!text) {
        return [];
      }

      const parsed = JSON.parse(text) as WorkspacePresetsFilePayload<T> | T[];
      const presets = Array.isArray(parsed) ? parsed : (parsed.presets ?? []);
      return presets.map((preset, index) => config.normalize(preset, index));
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read workspace ${config.label}: ${message}`);
    }
  }

  async function write(presets: T[], folder?: vscode.WorkspaceFolder): Promise<void> {
    const uri = getUri(folder);
    if (!uri) {
      throw new Error(`Open a workspace folder to save team ${config.label}.`);
    }

    const dir = vscode.Uri.joinPath(uri, '..');
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      await vscode.workspace.fs.createDirectory(dir);
    }

    const payload: WorkspacePresetsFilePayload<T> = {
      version: 1,
      presets: presets.map(config.stripRuntime),
    };
    const contents = `${JSON.stringify(payload, null, 2)}\n`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, 'utf8'));
  }

  function watch(onChange: () => void): vscode.Disposable {
    const pattern = config.getRelativePath().replace(/^\.\//, '');
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

  return {
    getRelativePath: config.getRelativePath,
    getUri,
    getFolder: getWorkspaceFolderForPresets,
    fileExists,
    read,
    write,
    watch,
  };
}

export type WorkspacePresetFileIO<T> = ReturnType<typeof createWorkspacePresetFileIO<T>>;

function isNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError &&
    (error.code === 'FileNotFound' || error.code === 'EntryNotFound')
  );
}
