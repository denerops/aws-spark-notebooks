const PIP_LINE_MAGIC = /^\s*%pip(?:3)?\s+(.+?)\s*$/;
const PIP_BANG_MAGIC = /^\s*!\s*pip(?:3)?\s+(.+?)\s*$/;

/**
 * Transform Jupyter `%pip` / `!pip` lines into driver-side pip execution on Livy.
 * Matches ipykernel `%pip` behavior: `python -m pip <args>` with stdout/stderr in output.
 */
export function transformJupyterPipMagics(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const pipMagic = line.match(PIP_LINE_MAGIC);
      if (pipMagic) {
        return `__emr_run_pip(${JSON.stringify(pipMagic[1])})`;
      }

      const pipBang = line.match(PIP_BANG_MAGIC);
      if (pipBang) {
        return `__emr_run_pip(${JSON.stringify(pipBang[1])})`;
      }

      return line;
    })
    .join('\n');
}

export function cellUsesPipMagic(code: string): boolean {
  return code.split('\n').some((line) => PIP_LINE_MAGIC.test(line) || PIP_BANG_MAGIC.test(line));
}

/** Cell contains only pip magic lines, blanks, or comments. */
export function isPipOnlyCell(code: string): boolean {
  const lines = code.split('\n');
  const hasPip = lines.some(
    (line) => PIP_LINE_MAGIC.test(line) || PIP_BANG_MAGIC.test(line)
  );
  if (!hasPip) {
    return false;
  }

  return lines.every((line) => {
    const trimmed = line.trim();
    return (
      !trimmed ||
      trimmed.startsWith('#') ||
      PIP_LINE_MAGIC.test(line) ||
      PIP_BANG_MAGIC.test(line)
    );
  });
}
