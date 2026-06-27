import * as vscode from 'vscode';
import type { SessionPresetStore } from '../session/presets';
import { SessionPresetsController } from './sessionPresetsController';

export interface SessionPresetsPanelOptions {
  presetId?: string;
  onMutated?: () => void;
}

export class SessionPresetsPanel {
  private static current: SessionPresetsPanel | undefined;
  readonly controller: SessionPresetsController;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    store: SessionPresetStore,
    options?: SessionPresetsPanelOptions
  ) {
    this.controller = new SessionPresetsController(store, () => this.panel.webview, {
      onMutated: options?.onMutated,
      onPresetLoaded: (preset) => {
        this.panel.title = preset ? `Preset: ${preset.name}` : 'Session Preset';
      },
      onDeleted: () => {
        this.panel.dispose();
      },
    });
    if (options?.presetId) {
      this.controller.setSelectedId(options.presetId);
    }
    this.controller.bind(panel.webview);
    panel.onDidDispose(() => {
      SessionPresetsPanel.current = undefined;
    });
    void this.controller.refresh();
  }

  static show(
    _context: vscode.ExtensionContext,
    store: SessionPresetStore,
    options?: SessionPresetsPanelOptions
  ): void {
    if (SessionPresetsPanel.current) {
      if (options?.presetId) {
        SessionPresetsPanel.current.controller.setSelectedId(options.presetId);
      }
      SessionPresetsPanel.current.panel.reveal();
      void SessionPresetsPanel.current.controller.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'emrServerlessSessionPresetsEditor',
      'Session Preset',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    SessionPresetsPanel.current = new SessionPresetsPanel(panel, store, options);
  }
}
