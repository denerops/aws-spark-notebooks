import * as vscode from 'vscode';

export async function promptSessionName(
  options?: { defaultValue?: string }
): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: 'Session name',
    prompt: 'Enter a name for this Livy session',
    placeHolder: 'e.g. dev-exploration',
    value: options?.defaultValue,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Session name is required.';
      }
      return undefined;
    },
  });

  return name?.trim() || undefined;
}
