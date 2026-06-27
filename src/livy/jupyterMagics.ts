import { splitTrailingComment } from './codeTransform';

const PIP_LINE_MAGIC = /^\s*%pip(?:3)?\s+(.+)$/;
const PIP_BANG_MAGIC = /^\s*!\s*pip(?:3)?\s+(.+)$/;

/**
 * Transform Jupyter `%pip` / `!pip` lines into driver-side pip execution on Livy.
 * Matches ipykernel `%pip` behavior: `python -m pip <args>` with stdout/stderr in output.
 */
export function transformJupyterPipMagics(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const { expr } = splitTrailingComment(line);
      const pipMagic = expr.match(PIP_LINE_MAGIC);
      if (pipMagic) {
        return `__emr_run_pip(${JSON.stringify(pipMagic[1].trim())})`;
      }

      const pipBang = expr.match(PIP_BANG_MAGIC);
      if (pipBang) {
        return `__emr_run_pip(${JSON.stringify(pipBang[1].trim())})`;
      }

      return line;
    })
    .join('\n');
}

export function cellUsesPipMagic(code: string): boolean {
  return code.split('\n').some((line) => {
    const { expr } = splitTrailingComment(line);
    return PIP_LINE_MAGIC.test(expr) || PIP_BANG_MAGIC.test(expr);
  });
}

/** Cell contains only pip magic lines, blanks, or comments. */
export function isPipOnlyCell(code: string): boolean {
  const lines = code.split('\n');
  const hasPip = lines.some((line) => {
    const { expr } = splitTrailingComment(line);
    return PIP_LINE_MAGIC.test(expr) || PIP_BANG_MAGIC.test(expr);
  });
  if (!hasPip) {
    return false;
  }

  return lines.every((line) => {
    const trimmed = line.trim();
    const { expr } = splitTrailingComment(line);
    return (
      !trimmed ||
      trimmed.startsWith('#') ||
      PIP_LINE_MAGIC.test(expr) ||
      PIP_BANG_MAGIC.test(expr)
    );
  });
}
