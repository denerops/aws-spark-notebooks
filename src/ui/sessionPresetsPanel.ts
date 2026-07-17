import * as vscode from 'vscode';
import type { SessionPreset, SessionPresetStore } from '../session/presets';
import { SessionPresetsController } from './sessionPresetsController';
import {
  createPresetEditorPanelHost,
  type PresetEditorPanelOptions,
} from '../presets/presetEditorPanel';

export type SessionPresetsPanelOptions = PresetEditorPanelOptions;

const host = createPresetEditorPanelHost<SessionPreset>({
  viewType: 'emrServerlessSessionPresetsEditor',
  defaultTitle: 'Session Preset',
  emptyTitle: 'Session Preset',
  titleForPreset: (preset) => `Preset: ${preset.name}`,
  createController: (store, getWebview, options) =>
    new SessionPresetsController(store, getWebview, options),
});

export class SessionPresetsPanel {
  static show(
    context: vscode.ExtensionContext,
    store: SessionPresetStore,
    options?: SessionPresetsPanelOptions
  ): void {
    host.show(context, store, options);
  }
}
