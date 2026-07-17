import type { GlueSessionPresetStore } from '../glue/presets';
import type { SessionPresetStore } from '../session/presets';
import type {
  EmrSparkBackendAdapter,
  GlueSparkBackendAdapter,
  SparkBackend,
} from '../platform/sparkBackend';
import { EmrKernelSteps } from './emrKernelSteps';
import { GlueKernelSteps } from './glueKernelSteps';
import type { KernelSelectionSteps } from './kernelSelectionSteps';
import { pickGlueSessionPreset } from './pickGlueSessionPreset';
import { pickSessionPreset } from './pickSessionPreset';
import { promptSessionName } from './promptSessionName';
import { createVscodeWizardUi } from './vscodeWizardUi';
import type { WizardUi } from './wizardUi';

export function createKernelSelectionSteps(
  emr: EmrSparkBackendAdapter,
  glue: GlueSparkBackendAdapter,
  emrPresetStore: SessionPresetStore,
  gluePresetStore: GlueSessionPresetStore,
  ui: WizardUi = createVscodeWizardUi()
): Record<SparkBackend, KernelSelectionSteps> {
  return {
    emr: new EmrKernelSteps(emr, emrPresetStore, ui, {
      pickPreset: pickSessionPreset,
      promptName: promptSessionName,
    }),
    glue: new GlueKernelSteps(glue, gluePresetStore, ui, {
      pickPreset: pickGlueSessionPreset,
      promptName: promptSessionName,
    }),
  };
}
