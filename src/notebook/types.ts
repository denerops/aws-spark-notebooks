export const NOTEBOOK_TYPE = 'emr-spark';
export const SERIALIZER_ID = 'emr-spark-serializer';
export const CONTROLLER_ID = 'emr-spark-controller';
export const KERNEL_SELECT_CONTROLLER_ID = 'emr-spark-select-kernel';

export function isEmrSparkNotebook(notebook?: { notebookType: string }): boolean {
  return notebook?.notebookType === NOTEBOOK_TYPE;
}

export interface SparkNotebookMetadata {
  applicationId?: string;
  sessionId?: number;
}

export interface SparknbDocument {
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    emrServerless?: SparkNotebookMetadata;
    [key: string]: unknown;
  };
  cells: SparknbCell[];
}

export interface SparknbCell {
  cell_type: 'markdown' | 'code';
  source: string | string[];
  metadata?: {
    language?: string;
    [key: string]: unknown;
  };
  outputs?: SparknbOutput[];
}

export interface SparknbOutput {
  output_type: 'execute_result' | 'display_data' | 'error' | 'stream';
  data?: Record<string, string | string[]>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  execution_count?: number | null;
  name?: string;
  text?: string | string[];
}

export function normalizeSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join('') : source;
}

export function toSourceArray(source: string): string[] {
  if (!source) {
    return [];
  }
  const lines = source.split('\n');
  return lines.map((line, index) =>
    index < lines.length - 1 ? `${line}\n` : line
  );
}

export function livyEndpointUrl(applicationId: string, region: string): string {
  return `https://${applicationId}.livy.emr-serverless-services.${region}.amazonaws.com`;
}
