import type { LivyStatement } from './types';

const STATE_LABELS: Record<string, string> = {
  waiting: 'Queued on Livy',
  running: 'Running on Spark',
  cancelling: 'Cancelling',
  available: 'Finishing',
};

export function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

export function formatStatementProgress(stmt: LivyStatement, elapsedMs: number): string {
  const label = STATE_LABELS[stmt.state] ?? stmt.state;
  const progress =
    stmt.progress !== undefined && stmt.progress > 0
      ? ` · ${Math.round(stmt.progress * 100)}%`
      : '';
  return `${label} · statement ${stmt.id} · ${formatElapsed(elapsedMs)}${progress}`;
}
