import * as vscode from 'vscode';
import {
  SparknbCell,
  SparknbDocument,
  SparknbOutput,
  NOTEBOOK_TYPE,
  normalizeSource,
  toSourceArray,
} from './types';
import { sanitizeErrorMessage } from '../output/errorMessage';
import { buildErrorHtml } from '../output/htmlError';
import type { ErrorPayload } from '../output/errorMapper';
import { parseSparknbContent } from './defaultDocument';
import {
  cellMetadataForSave,
  isDisplayOutput,
  isIpynbPath,
  mergeIpynbMetadata,
  resolveCellLanguage,
} from './ipynbCompat';

function uriKey(uri: vscode.Uri): string {
  return vscode.Uri.from({
    scheme: uri.scheme,
    authority: uri.authority,
    path: uri.path,
    query: uri.query,
    fragment: uri.fragment,
  }).toString();
}

function outputToNotebook(output: SparknbOutput): vscode.NotebookCellOutput | undefined {
  if (output.output_type === 'error') {
    const message = sanitizeErrorMessage(output.evalue ?? 'Unknown error');
    const html = buildErrorHtml(message);
    return new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(html, 'text/html'),
      vscode.NotebookCellOutputItem.text(message, 'text/plain'),
    ]);
  }

  if (isDisplayOutput(output) && output.data) {
    const items: vscode.NotebookCellOutputItem[] = [];
    for (const [mime, value] of Object.entries(output.data)) {
      const text = Array.isArray(value) ? value.join('') : value;
      if (mime === 'application/vnd.emr-spark.table+json') {
        items.push(vscode.NotebookCellOutputItem.json(JSON.parse(text), mime));
      } else {
        items.push(vscode.NotebookCellOutputItem.text(text, mime));
      }
    }
    if (items.length > 0) {
      return new vscode.NotebookCellOutput(items);
    }
  }

  if (output.output_type === 'stream' && output.text) {
    const text = Array.isArray(output.text) ? output.text.join('') : output.text;
    if (output.name === 'stderr') {
      return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(text)]);
    }
    return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stdout(text)]);
  }

  return undefined;
}

function notebookOutputToSparknb(output: vscode.NotebookCellOutput): SparknbOutput[] {
  for (const item of output.items) {
    if (item.mime === 'application/vnd.emr-spark.error+json') {
      const payload = JSON.parse(new TextDecoder().decode(item.data)) as ErrorPayload;
      const message = sanitizeErrorMessage(payload.message);
      return [
        {
          output_type: 'error',
          ename: 'Error',
          evalue: message,
          traceback: [message],
        },
      ];
    }
  }

  const results: SparknbOutput[] = [];

  for (const item of output.items) {
    if (item.mime === 'application/vnd.code.notebook.error') {
      const errorText = new TextDecoder().decode(item.data);
      const message = sanitizeErrorMessage(errorText);
      results.push({
        output_type: 'error',
        ename: 'Error',
        evalue: message,
        traceback: [message],
      });
      continue;
    }

    if (item.mime === 'application/vnd.emr-spark.error+json') {
      continue;
    }

    if (item.mime === 'application/x.stderr') {
      const text = new TextDecoder().decode(item.data);
      results.push({
        output_type: 'stream',
        name: 'stderr',
        text,
      });
      continue;
    }

    if (item.mime === 'application/x.stdout') {
      const text = new TextDecoder().decode(item.data);
      results.push({
        output_type: 'stream',
        name: 'stdout',
        text,
      });
      continue;
    }

    if (
      item.mime === 'text/plain' ||
      item.mime === 'text/html' ||
      item.mime === 'application/vnd.emr-spark.table+json'
    ) {
      const existing = results.find((r) => isDisplayOutput(r));
      if (item.mime === 'application/vnd.emr-spark.table+json') {
        const jsonText = JSON.stringify(JSON.parse(new TextDecoder().decode(item.data)));
        if (existing) {
          existing.data = existing.data ?? {};
          existing.data[item.mime] = jsonText;
        } else {
          results.push({
            output_type: 'execute_result',
            execution_count: null,
            data: { [item.mime]: jsonText },
          });
        }
      } else {
        const text = new TextDecoder().decode(item.data);
        if (existing) {
          existing.data = existing.data ?? {};
          existing.data[item.mime] = text;
        } else {
          results.push({
            output_type: 'execute_result',
            execution_count: null,
            data: { [item.mime]: text },
          });
        }
      }
    }
  }

  return results;
}

function cellToNotebook(
  cell: SparknbCell,
  docMetadata: SparknbDocument['metadata']
): vscode.NotebookCellData {
  const source = normalizeSource(cell.source);

  if (cell.cell_type === 'markdown') {
    return {
      kind: vscode.NotebookCellKind.Markup,
      languageId: 'markdown',
      value: source,
      metadata: cell.metadata ?? {},
      outputs: (cell.outputs ?? [])
        .map(outputToNotebook)
        .filter((o): o is vscode.NotebookCellOutput => o !== undefined),
    };
  }

  const languageId = resolveCellLanguage(cell, docMetadata);
  return {
    kind: vscode.NotebookCellKind.Code,
    languageId,
    value: source,
    metadata: cell.metadata ?? {},
    outputs: (cell.outputs ?? [])
      .map(outputToNotebook)
      .filter((o): o is vscode.NotebookCellOutput => o !== undefined),
  };
}

function notebookCellToSparknb(cell: vscode.NotebookCellData): SparknbCell {
  const outputs: SparknbOutput[] = [];
  for (const output of cell.outputs ?? []) {
    outputs.push(...notebookOutputToSparknb(output));
  }

  if (cell.kind === vscode.NotebookCellKind.Markup) {
    return {
      cell_type: 'markdown',
      source: toSourceArray(cell.value),
      metadata: cell.metadata,
      outputs,
    };
  }

  return {
    cell_type: 'code',
    source: toSourceArray(cell.value),
    metadata: cellMetadataForSave(
      { cell_type: 'code', source: cell.value, metadata: cell.metadata },
      cell.languageId
    ),
    outputs,
  };
}

export class SparknbSerializer implements vscode.NotebookSerializer {
  private lastUri: vscode.Uri | undefined;
  private pendingDeserializeBytes: Uint8Array | undefined;
  private readonly originalBytesByUri = new Map<string, Uint8Array>();
  private readonly dirtyUris = new Set<string>();

  setContext(uri: vscode.Uri): void {
    this.lastUri = uri;
  }

  private rememberOriginalBytes(uri: vscode.Uri, content: Uint8Array): void {
    this.originalBytesByUri.set(uriKey(uri), content);
    this.dirtyUris.delete(uriKey(uri));
  }

  markDirty(uri: vscode.Uri): void {
    this.dirtyUris.add(uriKey(uri));
  }

  markSaved(uri: vscode.Uri): void {
    this.dirtyUris.delete(uriKey(uri));
  }

  updateOriginalBytes(uri: vscode.Uri, content: Uint8Array): void {
    this.rememberOriginalBytes(uri, content);
  }

  clearUri(uri: vscode.Uri): void {
    const key = uriKey(uri);
    this.originalBytesByUri.delete(key);
    this.dirtyUris.delete(key);
    if (this.lastUri && uriKey(this.lastUri) === key) {
      this.lastUri = undefined;
    }
  }

  async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    this.pendingDeserializeBytes = content;
    const text = new TextDecoder().decode(content);
    const doc = parseSparknbContent(text, { preserveMetadata: true });

    return {
      metadata: doc.metadata ?? {},
      cells: doc.cells.map((cell) => cellToNotebook(cell, doc.metadata ?? {})),
    };
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const key = this.lastUri ? uriKey(this.lastUri) : undefined;
    if (key && !this.dirtyUris.has(key)) {
      const original = this.originalBytesByUri.get(key);
      if (original) {
        return original;
      }
    }

    const metadata =
      this.lastUri && isIpynbPath(this.lastUri.fsPath || this.lastUri.path)
        ? mergeIpynbMetadata(data.metadata ?? {})
        : { ...(data.metadata ?? {}) };

    const doc: SparknbDocument = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata,
      cells: data.cells.map(notebookCellToSparknb),
    };

    return new TextEncoder().encode(JSON.stringify(doc, null, 2));
  }

  consumePendingBytes(uri: vscode.Uri): void {
    if (this.pendingDeserializeBytes) {
      this.rememberOriginalBytes(uri, this.pendingDeserializeBytes);
      this.pendingDeserializeBytes = undefined;
    }
    this.setContext(uri);
  }
}

export function registerSerializer(context: vscode.ExtensionContext): void {
  const serializer = new SparknbSerializer();

  context.subscriptions.push(
    vscode.workspace.onDidOpenNotebookDocument((notebook) => {
      if (notebook.notebookType !== NOTEBOOK_TYPE) {
        return;
      }
      serializer.consumePendingBytes(notebook.uri);
    }),
    vscode.workspace.onDidSaveNotebookDocument(async (notebook) => {
      if (notebook.notebookType !== NOTEBOOK_TYPE) {
        return;
      }
      serializer.setContext(notebook.uri);
      try {
        const bytes = await vscode.workspace.fs.readFile(notebook.uri);
        serializer.updateOriginalBytes(notebook.uri, bytes);
      } catch {
        serializer.markSaved(notebook.uri);
      }
    }),
    vscode.workspace.onDidCloseNotebookDocument((notebook) => {
      if (notebook.notebookType === NOTEBOOK_TYPE) {
        serializer.clearUri(notebook.uri);
      }
    }),
    vscode.workspace.onDidChangeNotebookDocument((event) => {
      if (event.notebook.notebookType !== NOTEBOOK_TYPE) {
        return;
      }
      if (event.contentChanges.length === 0 && event.cellChanges.length === 0) {
        return;
      }
      serializer.markDirty(event.notebook.uri);
    })
  );

  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(NOTEBOOK_TYPE, serializer, {
      transientOutputs: false,
      transientCellMetadata: {
        executionOrder: true,
        vscode: true,
      },
      transientDocumentMetadata: {
        kernelspec: true,
        language_info: true,
        emrServerless: true,
      },
    })
  );
}
