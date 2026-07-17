import type { WizardQuickPickItem, WizardUi } from '../wizardUi';

type QuickPickHandler = (
  items: WizardQuickPickItem[],
  options: { title?: string; placeHolder?: string }
) => WizardQuickPickItem | undefined;

export class FakeWizardUi implements WizardUi {
  warnings: string[] = [];
  errors: string[] = [];
  infos: string[] = [];
  commands: Array<{ command: string; args: unknown[] }> = [];
  progressTitles: string[] = [];
  quickPickCalls: Array<{
    items: WizardQuickPickItem[];
    options: { title?: string; placeHolder?: string };
  }> = [];

  private quickPickHandlers: QuickPickHandler[] = [];
  private infoChoice: string | undefined;

  /** Queue successive QuickPick responses (undefined = cancel). */
  enqueueQuickPick(...handlers: Array<QuickPickHandler | WizardQuickPickItem | undefined>): void {
    for (const handler of handlers) {
      if (typeof handler === 'function') {
        this.quickPickHandlers.push(handler);
      } else {
        const item = handler;
        this.quickPickHandlers.push(() => item);
      }
    }
  }

  setInfoChoice(choice: string | undefined): void {
    this.infoChoice = choice;
  }

  showQuickPick<T extends WizardQuickPickItem>(
    items: T[],
    options: { title?: string; placeHolder?: string }
  ): Promise<T | undefined> {
    this.quickPickCalls.push({ items, options });
    const handler = this.quickPickHandlers.shift();
    if (!handler) {
      throw new Error(`Unexpected QuickPick: ${options.title ?? options.placeHolder}`);
    }
    return Promise.resolve(handler(items, options) as T | undefined);
  }

  async withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
    this.progressTitles.push(title);
    return task();
  }

  showWarningMessage(message: string): void {
    this.warnings.push(message);
  }

  showErrorMessage(message: string): void {
    this.errors.push(message);
  }

  async showInformationMessage(
    message: string,
    ..._items: string[]
  ): Promise<string | undefined> {
    this.infos.push(message);
    return this.infoChoice;
  }

  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    this.commands.push({ command, args });
    return undefined;
  }
}
