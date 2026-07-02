import * as vscode from 'vscode';

export async function promptSessionName(
  options?: { defaultValue?: string; title?: string; placeholder?: string; optional?: boolean }
): Promise<string | null | undefined> {
  const name = await vscode.window.showInputBox({
    title: options?.title ?? 'Session name',
    prompt: options?.optional
      ? 'Enter an optional description for this session'
      : 'Enter a name for this Livy session',
    placeHolder: options?.placeholder ?? 'e.g. dev-exploration',
    value: options?.defaultValue,
    validateInput: (value) => {
      if (!options?.optional && !value.trim()) {
        return 'Session name is required.';
      }
      return undefined;
    },
  });

  if (name === undefined) {
    return undefined;
  }
  const trimmed = name.trim();
  return trimmed || null;
}
