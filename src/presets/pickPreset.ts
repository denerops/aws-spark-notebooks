import * as vscode from 'vscode';
import type { PresetStore, PresetWithSource } from './createPresetStore';

export interface PresetPickFormat<T> {
  description: string;
  detail: string;
}

export interface PickPresetOptions<T extends PresetWithSource> {
  store: PresetStore<T>;
  formatItem: (preset: T) => PresetPickFormat<T>;
  configureCommand: string;
  configureLabel: string;
  configureDescription?: string;
  title?: string;
  placeHolder?: string;
  allowConfigure?: boolean;
}

type PresetPickItem<T> = vscode.QuickPickItem &
  (
    | {
        itemKind: 'preset';
        preset: T;
      }
    | {
        itemKind: 'configure';
      }
  );

export async function pickPreset<T extends PresetWithSource & { name: string }>(
  options: PickPresetOptions<T>
): Promise<T | undefined> {
  const {
    store,
    formatItem,
    configureCommand,
    configureLabel,
    configureDescription = 'Focus presets panel in sidebar',
    title = 'Select session preset',
    placeHolder = 'Choose session configuration',
    allowConfigure = true,
  } = options;

  const presets = await store.list();
  const items: PresetPickItem<T>[] = presets.map((preset) => {
    const scopePrefix =
      preset.source === 'workspace' ? '$(repo) ' : preset.source === 'user' ? '$(account) ' : '';
    const formatted = formatItem(preset);
    return {
      itemKind: 'preset' as const,
      label: `${scopePrefix}${preset.name}`,
      description: formatted.description,
      detail: formatted.detail,
      preset,
    };
  });

  if (allowConfigure) {
    items.push({
      itemKind: 'configure',
      label: configureLabel,
      description: configureDescription,
      detail: '',
    });
  }

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder,
  });

  if (!pick) {
    return undefined;
  }

  if (pick.itemKind === 'configure') {
    await vscode.commands.executeCommand(configureCommand);
    return pickPreset({ ...options, allowConfigure: false });
  }

  return pick.preset;
}

export function shortArn(arn: string): string {
  if (!arn) {
    return '(not set)';
  }
  const parts = arn.split('/');
  return parts.length > 1 ? parts[parts.length - 1] : arn;
}
