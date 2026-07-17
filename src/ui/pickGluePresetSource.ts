import type { GluePresetSource, GlueSessionPresetStore } from '../glue/presets';
import { DEFAULT_GLUE_WORKSPACE_PRESETS_FILE } from '../glue/presets';
import { pickPresetSource } from '../presets/pickPresetSource';

export async function pickGluePresetSource(
  store: GlueSessionPresetStore
): Promise<GluePresetSource | undefined> {
  return pickPresetSource({
    store,
    workspaceFileDescription: DEFAULT_GLUE_WORKSPACE_PRESETS_FILE,
    title: 'Glue preset scope',
    placeHolderWhenFileExists: 'Choose where to store the new Glue preset',
    placeHolderWhenNoFile: 'Create a workspace presets file for team sharing',
  });
}
