import type { GlueSessionPreset, GlueSessionPresetStore } from '../glue/presets';
import { pickPreset, shortArn } from '../presets/pickPreset';

export async function pickGlueSessionPreset(
  store: GlueSessionPresetStore,
  options?: { title?: string; allowConfigure?: boolean }
): Promise<GlueSessionPreset | undefined> {
  return pickPreset({
    store,
    formatItem: (preset) => ({
      description: `${preset.numberOfWorkers}× ${preset.workerType} · Glue ${preset.glueVersion}`,
      detail: `Role: ${shortArn(preset.roleArn)} · Idle: ${preset.idleTimeout ?? 30}m`,
    }),
    configureCommand: 'glueInteractive.openSessionPresets',
    configureLabel: '$(gear) Configure Glue session presets…',
    configureDescription: 'Focus Config panel in sidebar',
    title: options?.title ?? 'Select Glue session preset',
    placeHolder: 'Choose Glue workers, version, and IAM role configuration',
    allowConfigure: options?.allowConfigure,
  });
}
