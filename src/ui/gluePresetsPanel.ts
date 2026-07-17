import * as vscode from 'vscode';
import type { GlueSessionPreset, GlueSessionPresetStore } from '../glue/presets';
import { GluePresetsController } from './gluePresetsController';
import {
  createPresetEditorPanelHost,
  type PresetEditorPanelOptions,
} from '../presets/presetEditorPanel';

export type GluePresetsPanelOptions = PresetEditorPanelOptions;

const host = createPresetEditorPanelHost<GlueSessionPreset>({
  viewType: 'glueInteractiveSessionPresetsEditor',
  defaultTitle: 'Glue Session Preset',
  emptyTitle: 'Glue Session Preset',
  titleForPreset: (preset) => `Glue Preset: ${preset.name}`,
  createController: (store, getWebview, options) =>
    new GluePresetsController(store, getWebview, options),
});

export class GluePresetsPanel {
  static show(
    context: vscode.ExtensionContext,
    store: GlueSessionPresetStore,
    options?: GluePresetsPanelOptions
  ): void {
    host.show(context, store, options);
  }
}
