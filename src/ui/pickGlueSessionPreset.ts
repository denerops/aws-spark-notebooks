import * as vscode from 'vscode';
import type { GlueSessionPreset, GlueSessionPresetStore } from '../glue/presets';

type PresetPickItem = vscode.QuickPickItem & (
  | {
      itemKind: 'preset';
      preset: GlueSessionPreset;
    }
  | {
      itemKind: 'configure';
    }
);

export async function pickGlueSessionPreset(
  store: GlueSessionPresetStore,
  options?: { title?: string; allowConfigure?: boolean }
): Promise<GlueSessionPreset | undefined> {
  const presets = await store.list();
  const items: PresetPickItem[] = presets.map((preset) => {
    const scopePrefix =
      preset.source === 'workspace' ? '$(repo) ' : preset.source === 'user' ? '$(account) ' : '';
    return {
      itemKind: 'preset',
      label: `${scopePrefix}${preset.name}`,
      description: `${preset.numberOfWorkers}× ${preset.workerType} · Glue ${preset.glueVersion}`,
      detail: `Role: ${shortArn(preset.roleArn)} · Idle: ${preset.idleTimeout ?? 30}m`,
      preset,
    };
  });

  if (options?.allowConfigure !== false) {
    items.push({
      itemKind: 'configure',
      label: '$(gear) Configure Glue session presets…',
      description: 'Focus Config panel in sidebar',
      detail: '',
    });
  }

  const pick = await vscode.window.showQuickPick(items, {
    title: options?.title ?? 'Select Glue session preset',
    placeHolder: 'Choose Glue workers, version, and IAM role configuration',
  });

  if (!pick) {
    return undefined;
  }

  if (pick.itemKind === 'configure') {
    await vscode.commands.executeCommand('glueInteractive.openSessionPresets');
    return pickGlueSessionPreset(store, { ...options, allowConfigure: false });
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
