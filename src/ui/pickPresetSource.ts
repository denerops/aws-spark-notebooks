import type { SessionPresetSource, SessionPresetStore } from '../session/presets';
import { DEFAULT_WORKSPACE_PRESETS_FILE } from '../session/workspacePresets';
import { pickPresetSource as pickPresetSourceShared } from '../presets/pickPresetSource';

export async function pickPresetSource(
  store: SessionPresetStore
): Promise<SessionPresetSource | undefined> {
  return pickPresetSourceShared({
    store,
    workspaceFileDescription: DEFAULT_WORKSPACE_PRESETS_FILE,
  });
}
