import * as vscode from 'vscode';
import type { SessionPreset, SessionPresetStore } from '../session/presets';

export const SESSION_PRESETS_VIEW_ID = 'emrServerlessSessionPresets';

export class PresetsTreeItem extends vscode.TreeItem {
  constructor(public readonly preset: SessionPreset) {
    super(preset.name, vscode.TreeItemCollapsibleState.None);
    const scope =
      preset.source === 'workspace' ? 'workspace' : preset.source === 'user' ? 'personal' : undefined;
    const sizing = `${preset.numExecutors}× executor · ${preset.executorCores} cores · ${preset.executorMemory}`;
    this.description = scope ? `${scope} · ${sizing}` : sizing;
    this.tooltip = formatPresetTooltip(preset);
    this.contextValue = preset.source === 'workspace' ? 'presetWorkspace' : 'presetUser';
    this.iconPath =
      preset.source === 'workspace'
        ? new vscode.ThemeIcon('repo')
        : new vscode.ThemeIcon('account');
    this.command = {
      command: 'emrServerless.editSessionPreset',
      title: 'Edit Session Preset',
      arguments: [preset.id],
    };
  }
}

function formatPresetTooltip(preset: SessionPreset): string {
  const role = preset.executionRoleArn || '(no role set)';
  const scope =
    preset.source === 'workspace'
      ? 'Team preset (workspace file)'
      : preset.source === 'user'
        ? 'Personal preset'
        : undefined;
  return [
    preset.name,
    ...(scope ? [scope] : []),
    `Driver: ${preset.driverMemory}`,
    `Executors: ${preset.numExecutors} × ${preset.executorCores} cores × ${preset.executorMemory}`,
    `Role: ${role}`,
  ].join('\n');
}

export class SessionPresetsTreeProvider implements vscode.TreeDataProvider<PresetsTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<PresetsTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly store: SessionPresetStore) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: PresetsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<PresetsTreeItem[]> {
    const presets = await this.store.list();
    return presets.map((preset) => new PresetsTreeItem(preset));
  }
}

export function registerSessionPresetsTree(
  context: vscode.ExtensionContext,
  store: SessionPresetStore
): SessionPresetsTreeProvider {
  const tree = new SessionPresetsTreeProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(SESSION_PRESETS_VIEW_ID, tree),
    store.onDidChange(() => tree.refresh())
  );
  return tree;
}
