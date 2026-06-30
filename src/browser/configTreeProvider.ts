import * as vscode from 'vscode';
import { getEmrServerlessService } from '../aws/emrServerlessClient';
import { getConfiguredAwsProfile, getConfiguredAwsRegion } from '../aws/config';
import { getProfileDisplayLabel } from '../aws/profile';
import type { SessionPreset, SessionPresetStore } from '../session/presets';

export const CONFIG_VIEW_ID = 'emrServerlessConfig';

export type ConfigNodeKind =
  | 'awsProfile'
  | 'awsRegion'
  | 'presetsRoot'
  | 'preset'
  | 'presetEmpty';

export class ConfigTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: ConfigNodeKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      description?: string;
      tooltip?: string;
      command?: vscode.Command;
      iconPath?: vscode.ThemeIcon;
      preset?: SessionPreset;
    }
  ) {
    super(label, collapsibleState);
    this.description = options?.description;
    this.tooltip = options?.tooltip ?? label;
    this.command = options?.command;
    this.iconPath = options?.iconPath ?? iconForKind(kind);
    this.contextValue = kind === 'preset' ? contextValueForPreset(options?.preset) : kind;
    this.preset = options?.preset;
  }

  readonly preset?: SessionPreset;
}

function contextValueForPreset(preset?: SessionPreset): string {
  if (preset?.source === 'workspace') {
    return 'presetWorkspace';
  }
  if (preset?.source === 'user') {
    return 'presetUser';
  }
  return 'preset';
}

function iconForKind(kind: ConfigNodeKind): vscode.ThemeIcon {
  switch (kind) {
    case 'awsProfile':
      return new vscode.ThemeIcon('key');
    case 'awsRegion':
      return new vscode.ThemeIcon('globe');
    case 'presetsRoot':
      return new vscode.ThemeIcon('settings-gear');
    case 'preset':
      return new vscode.ThemeIcon('symbol-property');
    case 'presetEmpty':
      return new vscode.ThemeIcon('info');
  }
}

function iconForPreset(preset: SessionPreset): vscode.ThemeIcon {
  return preset.source === 'workspace'
    ? new vscode.ThemeIcon('repo')
    : new vscode.ThemeIcon('account');
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

function buildPresetItem(preset: SessionPreset): ConfigTreeItem {
  const scope = preset.source === 'workspace' ? 'workspace' : 'personal';
  const sizing = `${preset.numExecutors}× executor · ${preset.executorCores} cores · ${preset.executorMemory}`;
  return new ConfigTreeItem('preset', preset.name, vscode.TreeItemCollapsibleState.None, {
    description: `${scope} · ${sizing}`,
    tooltip: formatPresetTooltip(preset),
    iconPath: iconForPreset(preset),
    preset,
    command: {
      command: 'emrServerless.editSessionPreset',
      title: 'Edit Session Preset',
      arguments: [preset.id],
    },
  });
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<ConfigTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ConfigTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private region = '';
  private profileLabel = '';
  private presets: SessionPreset[] = [];

  constructor(private readonly store: SessionPresetStore) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async refreshPresets(): Promise<void> {
    this.presets = await this.store.list();
    this.refresh();
  }

  async refreshAwsContext(): Promise<void> {
    try {
      this.region = await getEmrServerlessService().getRegion();
    } catch {
      this.region = '';
    }
    this.profileLabel = await getProfileDisplayLabel();
    this.refresh();
  }

  async refreshAll(): Promise<void> {
    await Promise.all([this.refreshAwsContext(), this.refreshPresets()]);
  }

  getTreeItem(element: ConfigTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConfigTreeItem): ConfigTreeItem[] {
    if (!element) {
      return [this.buildProfileItem(), this.buildRegionItem(), this.buildPresetsRootItem()];
    }

    if (element.kind === 'presetsRoot') {
      if (this.presets.length === 0) {
        return [
          new ConfigTreeItem('presetEmpty', 'No session presets', vscode.TreeItemCollapsibleState.None, {
            description: 'Click + in toolbar to add',
          }),
        ];
      }
      return this.presets.map((preset) => buildPresetItem(preset));
    }

    return [];
  }

  private buildProfileItem(): ConfigTreeItem {
    const configured = getConfiguredAwsProfile();
    const value = configured ?? this.profileLabel;
    return new ConfigTreeItem('awsProfile', 'AWS Profile', vscode.TreeItemCollapsibleState.None, {
      description: value || 'auto',
      tooltip: configured
        ? `AWS profile: ${configured} — click to change`
        : `AWS credentials: ${this.profileLabel} — click to change`,
      command: {
        command: 'emrServerless.selectAwsProfile',
        title: 'Select AWS Profile',
      },
    });
  }

  private buildRegionItem(): ConfigTreeItem {
    const configured = getConfiguredAwsRegion();
    const value = this.region || '?';
    return new ConfigTreeItem('awsRegion', 'AWS Region', vscode.TreeItemCollapsibleState.None, {
      description: value,
      tooltip: configured
        ? `AWS region: ${configured} — click to change`
        : `AWS region: ${value} (from profile) — click to change`,
      command: {
        command: 'emrServerless.selectAwsRegion',
        title: 'Select AWS Region',
      },
    });
  }

  private buildPresetsRootItem(): ConfigTreeItem {
    const count = this.presets.length;
    return new ConfigTreeItem(
      'presetsRoot',
      'Session Presets',
      vscode.TreeItemCollapsibleState.Expanded,
      {
        description: count === 1 ? '1 preset' : `${count} presets`,
        tooltip: 'Workspace and personal Livy session presets',
      }
    );
  }
}

export function registerConfigTree(
  context: vscode.ExtensionContext,
  store: SessionPresetStore
): ConfigTreeProvider {
  const provider = new ConfigTreeProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(CONFIG_VIEW_ID, provider),
    store.onDidChange(() => void provider.refreshPresets())
  );
  void provider.refreshPresets();
  return provider;
}
