import * as vscode from 'vscode';
import type { SessionPreset, SessionPresetStore } from '../session/presets';

type PresetPickItem = vscode.QuickPickItem & (
  | {
      itemKind: 'preset';
      preset: SessionPreset;
    }
  | {
      itemKind: 'configure';
    }
);

export async function pickSessionPreset(
  store: SessionPresetStore,
  options?: { title?: string; allowConfigure?: boolean }
): Promise<SessionPreset | undefined> {
  const presets = await store.list();
  const items: PresetPickItem[] = presets.map((preset) => {
    const scopePrefix =
      preset.source === 'workspace' ? '$(repo) ' : preset.source === 'user' ? '$(account) ' : '';
    return {
      itemKind: 'preset',
      label: `${scopePrefix}${preset.name}`,
      description: `${preset.numExecutors}× executor · ${preset.executorCores} cores · ${preset.executorMemory}`,
      detail: `Role: ${shortArn(preset.executionRoleArn)} · Driver: ${preset.driverMemory}`,
      preset,
    };
  });

  if (options?.allowConfigure !== false) {
    items.push({
      itemKind: 'configure',
      label: '$(gear) Configure session presets…',
      description: 'Focus presets panel in sidebar',
      detail: '',
    });
  }

  const pick = await vscode.window.showQuickPick(items, {
    title: options?.title ?? 'Select session preset',
    placeHolder: 'Choose Spark executor, memory, and IAM role configuration',
  });

  if (!pick) {
    return undefined;
  }

  if (pick.itemKind === 'configure') {
    await vscode.commands.executeCommand('emrServerless.openSessionPresets');
    return pickSessionPreset(store, { ...options, allowConfigure: false });
  }

  return pick.preset;
}

function shortArn(arn: string): string {
  if (!arn) {
    return '(not set)';
  }
  const parts = arn.split('/');
  return parts.length > 1 ? parts[parts.length - 1] : arn;
}
