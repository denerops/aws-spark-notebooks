import * as vscode from 'vscode';
import { getEmrServerlessService } from '../aws/emrServerlessClient';
import { getConfiguredAwsProfile, getConfiguredAwsRegion } from '../aws/config';
import { getProfileDisplayLabel } from '../aws/profile';
import type { SessionPreset, SessionPresetStore } from '../session/presets';
import type { GlueSessionPreset, GlueSessionPresetStore } from '../glue/presets';

export const CONFIG_VIEW_ID = 'emrServerlessConfig';

export type ConfigNodeKind =
  | 'awsProfile'
  | 'awsRegion'
  | 'emrPresetsRoot'
  | 'gluePresetsRoot'
  | 'emrPreset'
  | 'gluePreset'
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
      emrPreset?: SessionPreset;
      gluePreset?: GlueSessionPreset;
    }
  ) {
    super(label, collapsibleState);
    this.description = options?.description;
    this.tooltip = options?.tooltip ?? label;
    this.command = options?.command;
    this.iconPath = options?.iconPath ?? iconForKind(kind);
    this.contextValue = contextValueForKind(kind, options?.emrPreset, options?.gluePreset);
    this.emrPreset = options?.emrPreset;
    this.gluePreset = options?.gluePreset;
  }

  readonly emrPreset?: SessionPreset;
  readonly gluePreset?: GlueSessionPreset;
}

function contextValueForKind(
  kind: ConfigNodeKind,
  emrPreset?: SessionPreset,
  gluePreset?: GlueSessionPreset
): string {
  if (kind === 'emrPreset') {
    if (emrPreset?.source === 'workspace') {
      return 'emrPresetWorkspace';
    }
    if (emrPreset?.source === 'user') {
      return 'emrPresetUser';
    }
    return 'emrPreset';
  }
  if (kind === 'gluePreset') {
    if (gluePreset?.source === 'workspace') {
      return 'gluePresetWorkspace';
    }
    if (gluePreset?.source === 'user') {
      return 'gluePresetUser';
    }
    return 'gluePreset';
  }
  return kind;
}

function iconForKind(kind: ConfigNodeKind): vscode.ThemeIcon {
  switch (kind) {
    case 'awsProfile':
      return new vscode.ThemeIcon('key');
    case 'awsRegion':
      return new vscode.ThemeIcon('globe');
    case 'emrPresetsRoot':
      return new vscode.ThemeIcon('server-environment');
    case 'gluePresetsRoot':
      return new vscode.ThemeIcon('cloud');
    case 'emrPreset':
    case 'gluePreset':
      return new vscode.ThemeIcon('symbol-property');
    case 'presetEmpty':
      return new vscode.ThemeIcon('info');
  }
}

function iconForPreset(source?: 'workspace' | 'user'): vscode.ThemeIcon {
  return source === 'workspace'
    ? new vscode.ThemeIcon('repo')
    : new vscode.ThemeIcon('account');
}

function formatEmrPresetTooltip(preset: SessionPreset): string {
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

function formatGluePresetTooltip(preset: GlueSessionPreset): string {
  const role = preset.roleArn || '(no role set)';
  const scope =
    preset.source === 'workspace'
      ? 'Team preset (workspace file)'
      : preset.source === 'user'
        ? 'Personal preset'
        : undefined;
  return [
    preset.name,
    ...(scope ? [scope] : []),
    `Glue ${preset.glueVersion}`,
    `Workers: ${preset.numberOfWorkers} × ${preset.workerType}`,
    `Role: ${role}`,
  ].join('\n');
}

function buildEmrPresetItem(preset: SessionPreset): ConfigTreeItem {
  const scope = preset.source === 'workspace' ? 'workspace' : 'personal';
  const sizing = `${preset.numExecutors}× executor · ${preset.executorCores} cores · ${preset.executorMemory}`;
  return new ConfigTreeItem('emrPreset', preset.name, vscode.TreeItemCollapsibleState.None, {
    description: `${scope} · ${sizing}`,
    tooltip: formatEmrPresetTooltip(preset),
    iconPath: iconForPreset(preset.source),
    emrPreset: preset,
    command: {
      command: 'emrServerless.editSessionPreset',
      title: 'Edit EMR Session Preset',
      arguments: [preset.id],
    },
  });
}

function buildGluePresetItem(preset: GlueSessionPreset): ConfigTreeItem {
  const scope = preset.source === 'workspace' ? 'workspace' : 'personal';
  const sizing = `${preset.numberOfWorkers}× ${preset.workerType} · Glue ${preset.glueVersion}`;
  return new ConfigTreeItem('gluePreset', preset.name, vscode.TreeItemCollapsibleState.None, {
    description: `${scope} · ${sizing}`,
    tooltip: formatGluePresetTooltip(preset),
    iconPath: iconForPreset(preset.source),
    gluePreset: preset,
    command: {
      command: 'glueInteractive.editSessionPreset',
      title: 'Edit Glue Session Preset',
      arguments: [preset.id],
    },
  });
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<ConfigTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ConfigTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private region = '';
  private profileLabel = '';
  private emrPresets: SessionPreset[] = [];
  private gluePresets: GlueSessionPreset[] = [];

  constructor(
    private readonly emrStore: SessionPresetStore,
    private readonly glueStore: GlueSessionPresetStore
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async refreshEmrPresets(): Promise<void> {
    this.emrPresets = await this.emrStore.list();
    this.refresh();
  }

  async refreshGluePresets(): Promise<void> {
    this.gluePresets = await this.glueStore.list();
    this.refresh();
  }

  async refreshPresets(): Promise<void> {
    await Promise.all([this.refreshEmrPresets(), this.refreshGluePresets()]);
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
      return [
        this.buildProfileItem(),
        this.buildRegionItem(),
        this.buildEmrPresetsRootItem(),
        this.buildGluePresetsRootItem(),
      ];
    }

    if (element.kind === 'emrPresetsRoot') {
      if (this.emrPresets.length === 0) {
        return [
          new ConfigTreeItem('presetEmpty', 'No EMR session presets', vscode.TreeItemCollapsibleState.None, {
            description: 'Use + on EMR Session Presets',
          }),
        ];
      }
      return this.emrPresets.map((preset) => buildEmrPresetItem(preset));
    }

    if (element.kind === 'gluePresetsRoot') {
      if (this.gluePresets.length === 0) {
        return [
          new ConfigTreeItem('presetEmpty', 'No Glue session presets', vscode.TreeItemCollapsibleState.None, {
            description: 'Use + on Glue Session Presets',
          }),
        ];
      }
      return this.gluePresets.map((preset) => buildGluePresetItem(preset));
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

  private buildEmrPresetsRootItem(): ConfigTreeItem {
    const count = this.emrPresets.length;
    return new ConfigTreeItem(
      'emrPresetsRoot',
      'EMR Session Presets',
      vscode.TreeItemCollapsibleState.Expanded,
      {
        description: count === 1 ? '1 preset' : `${count} presets`,
        tooltip: 'Livy session presets for EMR Serverless',
      }
    );
  }

  private buildGluePresetsRootItem(): ConfigTreeItem {
    const count = this.gluePresets.length;
    return new ConfigTreeItem(
      'gluePresetsRoot',
      'Glue Session Presets',
      vscode.TreeItemCollapsibleState.Expanded,
      {
        description: count === 1 ? '1 preset' : `${count} presets`,
        tooltip: 'Interactive session presets for AWS Glue (Livy)',
      }
    );
  }
}

export function registerConfigTree(
  context: vscode.ExtensionContext,
  emrStore: SessionPresetStore,
  glueStore: GlueSessionPresetStore
): ConfigTreeProvider {
  const provider = new ConfigTreeProvider(emrStore, glueStore);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(CONFIG_VIEW_ID, provider),
    emrStore.onDidChange(() => void provider.refreshEmrPresets()),
    glueStore.onDidChange(() => void provider.refreshGluePresets())
  );
  void provider.refreshPresets();
  return provider;
}
