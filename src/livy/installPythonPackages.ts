import {
  assertValidPythonPackageSpecs,
  normalizePythonPackages,
} from '../session/pythonPackages';
import type { LivyStatement } from './types';
import type { LivySession } from './session';

export function buildPipInstallCode(packages: string[]): string | undefined {
  const specs = normalizePythonPackages(packages);
  if (specs.length === 0) {
    return undefined;
  }
  assertValidPythonPackageSpecs(specs);
  const argString = `install --quiet ${specs.join(' ')}`;
  return `__emr_run_pip(${JSON.stringify(argString)})`;
}

function formatStatementError(stmt: LivyStatement): string {
  const trace = stmt.output?.traceback?.join('\n');
  if (trace) {
    return trace;
  }
  if (stmt.output?.evalue) {
    return stmt.output.evalue;
  }
  return `Livy statement failed (state: ${stmt.state})`;
}

export async function installPresetPythonPackages(
  session: LivySession,
  packages?: string[]
): Promise<void> {
  const code = buildPipInstallCode(packages ?? []);
  if (!code) {
    return;
  }

  const stmt = await session.executeStatement(code, 'pyspark', { skipDisplayWrap: true });
  if (stmt.output?.status === 'error' || stmt.state === 'error' || stmt.state === 'cancelled') {
    throw new Error(`Failed to install Python packages:\n${formatStatementError(stmt)}`);
  }
}
