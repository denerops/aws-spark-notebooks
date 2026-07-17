import type { GlueNotebookMetadata, SparkNotebookMetadata } from '../notebook/types';

/** Minimal notebook shape Notebook Connection needs (real docs or fakes). */
export interface NotebookRef {
  uri: { toString(): string; scheme?: string };
  metadata: {
    emrServerless?: SparkNotebookMetadata;
    glueInteractive?: GlueNotebookMetadata;
    [key: string]: unknown;
  };
  notebookType: string;
}

/**
 * Internal seam for notebook metadata I/O and document enumeration.
 * Production uses VS Code; tests inject an in-memory adapter.
 */
export interface NotebookWorkspace {
  applyMetadata(notebook: NotebookRef, metadata: NotebookRef['metadata']): Promise<void>;
  listSparkNotebooks(): NotebookRef[];
  getActiveSparkNotebook(): NotebookRef | undefined;
}
