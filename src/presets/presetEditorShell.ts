import type { PresetStore, PresetWithSource } from './createPresetStore';

export type PresetPanelMessage<T> =
  | { type: 'save'; preset: T }
  | { type: 'delete'; id: string };

export interface PresetEditorControllerOptions<T> {
  onMutated?: () => void;
  onPresetLoaded?: (preset: T | undefined) => void;
  onDeleted?: () => void;
}

/** UI side effects — injectable for tests. */
export interface PresetEditorUi {
  showErrorMessage(message: string): void;
  showInformationMessage(message: string): void;
  showDeleteConfirm(message: string): Promise<'Delete' | undefined>;
}

export interface PresetEditorShellConfig<T extends PresetWithSource & { name: string }> {
  store: PresetStore<T>;
  getWebview: () => { html: string } | undefined;
  options?: PresetEditorControllerOptions<T>;
  renderHtml: (preset: T | undefined) => string;
  prepareForSave?: (preset: T) => T;
  savedMessage: (preset: T, scopeLabel: string) => string;
  deleteConfirmMessage: (name: string) => string;
  deletedMessage: (name: string) => string;
  emptyStateTitle: string;
  ui: PresetEditorUi;
}

export class PresetEditorController<T extends PresetWithSource & { name: string; id: string }> {
  private selectedId: string | undefined;

  constructor(private readonly config: PresetEditorShellConfig<T>) {}

  bind(webview: {
    onDidReceiveMessage: (listener: (msg: PresetPanelMessage<T>) => void) => void;
  }): void {
    webview.onDidReceiveMessage((msg: PresetPanelMessage<T>) => {
      void this.handleMessage(msg);
    });
  }

  setSelectedId(id: string | undefined): void {
    this.selectedId = id;
  }

  getSelectedId(): string | undefined {
    return this.selectedId;
  }

  async handleMessage(msg: PresetPanelMessage<T>): Promise<void> {
    const {
      store,
      options,
      prepareForSave,
      savedMessage,
      deleteConfirmMessage,
      deletedMessage,
      ui,
    } = this.config;

    switch (msg.type) {
      case 'save': {
        const preset = msg.preset;
        if (!preset.name.trim()) {
          ui.showErrorMessage('Preset name is required.');
          return;
        }
        const existing = this.selectedId ? await store.get(this.selectedId) : undefined;
        const source = existing?.source ?? preset.source;
        const toSave = prepareForSave ? prepareForSave(preset) : preset;
        try {
          await store.save(toSave, source);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ui.showErrorMessage(message);
          return;
        }
        this.selectedId = preset.id;
        options?.onMutated?.();
        const scopeLabel = source === 'workspace' ? 'workspace' : 'personal';
        ui.showInformationMessage(savedMessage(preset, scopeLabel));
        await this.refresh();
        break;
      }
      case 'delete': {
        const preset = await store.get(msg.id);
        const name = preset?.name ?? 'this preset';
        const choice = await ui.showDeleteConfirm(deleteConfirmMessage(name));
        if (choice !== 'Delete') {
          return;
        }
        try {
          await store.delete(msg.id);
          this.selectedId = undefined;
          options?.onMutated?.();
          ui.showInformationMessage(deletedMessage(name));
          options?.onDeleted?.();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ui.showErrorMessage(message);
        }
        break;
      }
    }
  }

  async refresh(): Promise<void> {
    const webview = this.config.getWebview();
    if (!webview) {
      return;
    }

    let preset: T | undefined;
    if (this.selectedId) {
      preset = await this.config.store.get(this.selectedId);
      if (!preset) {
        this.selectedId = undefined;
      }
    }

    this.config.options?.onPresetLoaded?.(preset);
    webview.html = this.config.renderHtml(preset);
  }
}
