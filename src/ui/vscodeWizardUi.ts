import * as vscode from 'vscode';
import type { WizardUi } from './wizardUi';

export function createVscodeWizardUi(): WizardUi {
  return {
    async showQuickPick(items, options) {
      return vscode.window.showQuickPick(items, options);
    },
    async withProgress(title, task) {
      return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title },
        () => task()
      );
    },
    showWarningMessage(message) {
      void vscode.window.showWarningMessage(message);
    },
    showErrorMessage(message) {
      void vscode.window.showErrorMessage(message);
    },
    async showInformationMessage(message, ...items) {
      return vscode.window.showInformationMessage(message, ...items);
    },
    async executeCommand(command, ...args) {
      return vscode.commands.executeCommand(command, ...args);
    },
  };
}
