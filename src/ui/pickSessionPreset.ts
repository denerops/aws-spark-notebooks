import type { SessionPreset, SessionPresetStore } from '../session/presets';
import { pickPreset, shortArn } from '../presets/pickPreset';

export async function pickSessionPreset(
  store: SessionPresetStore,
  options?: { title?: string; allowConfigure?: boolean }
): Promise<SessionPreset | undefined> {
  return pickPreset({
    store,
    formatItem: (preset) => ({
      description: `${preset.numExecutors}× executor · ${preset.executorCores} cores · ${preset.executorMemory}`,
      detail: `Role: ${shortArn(preset.executionRoleArn)} · Driver: ${preset.driverMemory}`,
    }),
    configureCommand: 'emrServerless.openSessionPresets',
    configureLabel: '$(gear) Configure session presets…',
    title: options?.title ?? 'Select session preset',
    placeHolder: 'Choose Spark executor, memory, and IAM role configuration',
    allowConfigure: options?.allowConfigure,
  });
}
