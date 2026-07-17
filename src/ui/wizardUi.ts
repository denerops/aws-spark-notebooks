export interface WizardQuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

export interface WizardUi {
  showQuickPick<T extends WizardQuickPickItem>(
    items: T[],
    options: { title?: string; placeHolder?: string }
  ): Promise<T | undefined>;
  withProgress<T>(title: string, task: () => Promise<T>): Promise<T>;
  showWarningMessage(message: string): void;
  showErrorMessage(message: string): void;
  showInformationMessage(
    message: string,
    ...items: string[]
  ): Promise<string | undefined>;
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
}
