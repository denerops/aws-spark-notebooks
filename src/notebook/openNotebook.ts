import * as vscode from 'vscode';
import { NOTEBOOK_TYPE, isEmrSparkNotebook } from './types';

function uriKey(uri: vscode.Uri): string {
  return vscode.Uri.from({
    scheme: uri.scheme,
    authority: uri.authority,
    path: uri.path,
    query: uri.query,
    fragment: uri.fragment,
  }).toString();
}

function uriMatches(a: vscode.Uri, b: vscode.Uri): boolean {
  return uriKey(a) === uriKey(b);
}

function isNotebookTabInput(input: unknown): input is vscode.TabInputNotebook {
  if (input instanceof vscode.TabInputNotebook) {
    return true;
  }
  if (typeof input !== 'object' || input === null) {
    return false;
  }
  const candidate = input as { uri?: unknown; notebookType?: unknown };
  return candidate.uri instanceof vscode.Uri && typeof candidate.notebookType === 'string';
}

function findNotebookTabsForUri(uri: vscode.Uri): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => {
      if (!isNotebookTabInput(tab.input)) {
        return false;
      }
      return uriMatches(tab.input.uri, uri);
    })
  );
}

async function closeNotebookTabs(tabs: vscode.Tab[]): Promise<boolean> {
  if (tabs.length === 0) {
    return true;
  }
  const closed = await vscode.window.tabGroups.close(tabs);
  if (!closed) {
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  return true;
}

async function waitForConflictingNotebooksToClose(uri: vscode.Uri): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const hasConflict = vscode.workspace.notebookDocuments.some(
      (notebook) => uriMatches(notebook.uri, uri) && !isEmrSparkNotebook(notebook)
    );
    if (!hasConflict) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function closeConflictingNotebookTabs(uri: vscode.Uri): Promise<boolean> {
  const conflictingTabs = findNotebookTabsForUri(uri).filter((tab) => {
    if (!isNotebookTabInput(tab.input)) {
      return false;
    }
    return tab.input.notebookType !== NOTEBOOK_TYPE;
  });

  if (conflictingTabs.length === 0) {
    return true;
  }

  const closed = await closeNotebookTabs(conflictingTabs);
  if (!closed) {
    void vscode.window.showWarningMessage(
      'Close the existing notebook tab for this file first, then open it with EMR Serverless PySpark.'
    );
    return false;
  }

  return waitForConflictingNotebooksToClose(uri);
}

/**
 * Open a notebook with the EMR Serverless view type, reusing an existing tab when
 * possible and closing other notebook view types for the same file first.
 */
export async function openEmrSparkNotebook(
  uri: vscode.Uri
): Promise<vscode.NotebookDocument | undefined> {
  const existingEmr = vscode.workspace.notebookDocuments.find(
    (notebook) => uriMatches(notebook.uri, uri) && isEmrSparkNotebook(notebook)
  );
  if (existingEmr) {
    await vscode.window.showNotebookDocument(existingEmr);
    return existingEmr;
  }

  const canOpen = await closeConflictingNotebookTabs(uri);
  if (!canOpen) {
    return undefined;
  }

  await vscode.commands.executeCommand('vscode.openWith', uri, NOTEBOOK_TYPE);

  return vscode.workspace.notebookDocuments.find(
    (notebook) => uriMatches(notebook.uri, uri) && isEmrSparkNotebook(notebook)
  );
}

/**
 * Reveal an already-open EMR notebook when the user selects the file in the explorer.
 */
export async function revealEmrSparkNotebookIfOpen(uri: vscode.Uri): Promise<boolean> {
  const existingEmr = vscode.workspace.notebookDocuments.find(
    (notebook) => uriMatches(notebook.uri, uri) && isEmrSparkNotebook(notebook)
  );
  if (!existingEmr) {
    return false;
  }
  await vscode.window.showNotebookDocument(existingEmr);
  return true;
}
