import { normalizeSource, type SparknbCell, type SparknbDocument, type SparknbOutput } from './types';

export const EMR_KERNELSPEC = {
  name: 'emr-spark',
  display_name: 'EMR Serverless PySpark',
  language: 'python',
} as const;

export const EMR_LANGUAGE_INFO = {
  name: 'python',
  version: '3.10.0',
  mimetype: 'text/x-python',
  file_extension: '.py',
} as const;

export function isIpynbPath(path: string): boolean {
  return path.toLowerCase().endsWith('.ipynb');
}

export function resolveCellLanguage(
  cell: SparknbCell,
  docMetadata: SparknbDocument['metadata']
): string {
  const meta = cell.metadata ?? {};
  const vscodeLang = (meta.vscode as { languageId?: string } | undefined)?.languageId;
  if (typeof vscodeLang === 'string' && vscodeLang) {
    return vscodeLang;
  }
  if (typeof meta.language === 'string' && meta.language) {
    return meta.language;
  }

  const source = normalizeSource(cell.source);
  if (/^%%sql\b/m.test(source)) {
    return 'sql';
  }
  if (/^%%python\b/m.test(source) || /^%%pyspark\b/m.test(source)) {
    return 'python';
  }

  const kernelspec = docMetadata.kernelspec as { language?: string } | undefined;
  return kernelspec?.language ?? 'python';
}

export function stripCellMagic(code: string, languageId: string): string {
  if (languageId !== 'sql') {
    return code;
  }
  return code.replace(/^%%sql\s*\n?/im, '').trim();
}

export function prepareCellCode(
  rawCode: string,
  languageId: string
): { language: string; code: string } {
  const language = languageId === 'sql' || /^%%sql\b/m.test(rawCode) ? 'sql' : languageId;
  return {
    language,
    code: stripCellMagic(rawCode, language).trim(),
  };
}

export function mergeIpynbMetadata(
  metadata: SparknbDocument['metadata']
): SparknbDocument['metadata'] {
  return {
    ...metadata,
    kernelspec: {
      ...EMR_KERNELSPEC,
      ...(metadata.kernelspec as object | undefined),
      name: EMR_KERNELSPEC.name,
      display_name: EMR_KERNELSPEC.display_name,
    },
    language_info: {
      ...EMR_LANGUAGE_INFO,
      ...(metadata.language_info as object | undefined),
    },
  };
}

export function cellMetadataForSave(
  cell: SparknbCell,
  languageId: string
): SparknbCell['metadata'] {
  const metadata = { ...(cell.metadata ?? {}) };
  metadata.language = languageId;
  metadata.vscode = {
    ...(metadata.vscode as object | undefined),
    languageId,
  };
  return metadata;
}

export function isDisplayOutput(output: SparknbOutput): boolean {
  return output.output_type === 'execute_result' || output.output_type === 'display_data';
}
