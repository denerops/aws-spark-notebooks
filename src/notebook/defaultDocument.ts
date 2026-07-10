import type { GlueNotebookMetadata, SparkNotebookMetadata } from './types';
import { EMR_KERNELSPEC, EMR_LANGUAGE_INFO } from './ipynbCompat';

function baseMetadata(emrServerless: SparkNotebookMetadata = {}) {
  return {
    emrServerless,
    glueInteractive: {} as GlueNotebookMetadata,
    kernelspec: { ...EMR_KERNELSPEC },
    language_info: { ...EMR_LANGUAGE_INFO },
  };
}

export function createBlankSparknbDocument(
  emrServerless: SparkNotebookMetadata = {}
) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: baseMetadata(emrServerless),
    cells: [],
  };
}

export function createStarterSparknbDocument(
  emrServerless: SparkNotebookMetadata = {}
) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: baseMetadata(emrServerless),
    cells: [
      {
        cell_type: 'markdown',
        source: [
          '# AWS Spark Notebook\n',
          '\n',
          'Connect to a Livy session from the EMR Serverless sidebar, then run Python and Spark SQL cells.\n',
        ],
        metadata: {},
      },
      {
        cell_type: 'code',
        metadata: { language: 'python' },
        source: ['spark.range(5).toDF("id")\n'],
        outputs: [],
      },
      {
        cell_type: 'code',
        metadata: { language: 'sql' },
        source: ['SELECT id FROM range(5)\n'],
        outputs: [],
      },
    ],
  };
}

export function parseSparknbContent(text: string, options?: { preserveMetadata?: boolean }) {
  const trimmed = text.trim();
  if (!trimmed) {
    return createBlankSparknbDocument();
  }

  try {
    const parsed = JSON.parse(trimmed) as ReturnType<typeof createBlankSparknbDocument>;
    if (!parsed || typeof parsed !== 'object') {
      return createBlankSparknbDocument();
    }

    if (options?.preserveMetadata) {
      return {
        nbformat: parsed.nbformat ?? 4,
        nbformat_minor: parsed.nbformat_minor ?? 5,
        metadata: parsed.metadata ?? {},
        cells: Array.isArray(parsed.cells) ? parsed.cells : [],
      };
    }

    const blank = createBlankSparknbDocument();
    return {
      nbformat: parsed.nbformat ?? blank.nbformat,
      nbformat_minor: parsed.nbformat_minor ?? blank.nbformat_minor,
      metadata: {
        ...blank.metadata,
        ...parsed.metadata,
        emrServerless: {
          ...blank.metadata.emrServerless,
          ...(parsed.metadata?.emrServerless ?? {}),
        },
        glueInteractive: {
          ...(blank.metadata.glueInteractive ?? {}),
          ...((parsed.metadata?.glueInteractive as GlueNotebookMetadata | undefined) ?? {}),
        },
      },
      cells: Array.isArray(parsed.cells) ? parsed.cells : [],
    };
  } catch {
    return createBlankSparknbDocument();
  }
}
