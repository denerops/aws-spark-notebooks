import * as vscode from 'vscode';
import type { GlueSessionPresetStore } from '../glue/presets';
import { GluePresetsController } from './gluePresetsController';

export interface GluePresetsPanelOptions {
  presetId?: string;
  onMutated?: () => void;
}

export class GluePresetsPanel {
  private static current: GluePresetsPanel | undefined;
  readonly controller: GluePresetsController;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    store: GlueSessionPresetStore,
    options?: GluePresetsPanelOptions
  ) {
    this.controller = new GluePresetsController(store, () => this.panel.webview, {
      onMutated: options?.onMutated,
      onPresetLoaded: (preset) => {
        this.panel.title = preset ? `Glue Preset: ${preset.name}` : 'Glue Session Preset';
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
      GluePresetsPanel.current = undefined;
    });
    void this.controller.refresh();
  }

  static show(
    _context: vscode.ExtensionContext,
    store: GlueSessionPresetStore,
    options?: GluePresetsPanelOptions
  ): void {
    if (GluePresetsPanel.current) {
      if (options?.presetId) {
        GluePresetsPanel.current.controller.setSelectedId(options.presetId);
      }
      GluePresetsPanel.current.panel.reveal();
      void GluePresetsPanel.current.controller.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'glueInteractiveSessionPresetsEditor',
      'Glue Session Preset',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    GluePresetsPanel.current = new GluePresetsPanel(panel, store, options);
  }
}
