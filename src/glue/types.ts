export type GlueSessionStatus =
  | 'PROVISIONING'
  | 'READY'
  | 'FAILED'
  | 'TIMEOUT'
  | 'STOPPING'
  | 'STOPPED'
  | string;

import type { Statement } from '@aws-sdk/client-glue';

export type GlueStatementState =
  | 'WAITING'
  | 'RUNNING'
  | 'AVAILABLE'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'ERROR'
  | string;

const TERMINAL_STATEMENT_STATES = new Set(['available', 'error', 'cancelled']);

export interface GlueSessionSummary {
  id: string;
  description?: string;
  status: GlueSessionStatus;
  role?: string;
  glueVersion?: string;
  workerType?: string;
  numberOfWorkers?: number;
  idleTimeout?: number;
  sessionType?: string;
  createdOn?: Date;
}

export function formatGlueSessionLabel(session: Pick<GlueSessionSummary, 'id' | 'description'>): string {
  const description = session.description?.trim();
  return description || session.id;
}

export function mapGlueStatusToLivyState(status: GlueSessionStatus): string {
  switch (status) {
    case 'READY':
      return 'idle';
    case 'PROVISIONING':
      return 'starting';
    case 'STOPPING':
      return 'shutting_down';
    case 'STOPPED':
    case 'FAILED':
    case 'TIMEOUT':
      return 'dead';
    default:
      return status.toLowerCase();
  }
}

export function mapGlueStatementState(state: GlueStatementState): string {
  return state.toLowerCase();
}

/** Glue uses Statement.State for progress and Output.Status of `ok`/`error` when finished. */
export function isGlueStatementTerminal(raw: Statement): boolean {
  const statementState = raw.State ? mapGlueStatementState(raw.State) : undefined;
  const outputStatus = raw.Output?.Status ? mapGlueStatementState(raw.Output.Status) : undefined;

  if (statementState && TERMINAL_STATEMENT_STATES.has(statementState)) {
    return true;
  }
  if (outputStatus === 'ok' || outputStatus === 'error') {
    return true;
  }
  return Boolean(outputStatus && TERMINAL_STATEMENT_STATES.has(outputStatus));
}

export function resolveGlueStatementStatus(raw: Statement): string {
  const statementState = raw.State ? mapGlueStatementState(raw.State) : undefined;
  const outputStatus = raw.Output?.Status ? mapGlueStatementState(raw.Output.Status) : undefined;

  if (statementState && TERMINAL_STATEMENT_STATES.has(statementState)) {
    return statementState;
  }
  if (outputStatus === 'ok') {
    return 'available';
  }
  if (outputStatus === 'error') {
    return 'error';
  }
  if (outputStatus && TERMINAL_STATEMENT_STATES.has(outputStatus)) {
    return outputStatus;
  }
  return statementState ?? outputStatus ?? 'unknown';
}

export function mapGlueSession(session: {
  Id?: string;
  Description?: string;
  Status?: string;
  Role?: string;
  GlueVersion?: string;
  WorkerType?: string;
  NumberOfWorkers?: number;
  IdleTimeout?: number;
  SessionType?: string;
  CreatedOn?: Date;
}): GlueSessionSummary {
  return {
    id: session.Id ?? '',
    description: session.Description,
    status: session.Status ?? 'UNKNOWN',
    role: session.Role,
    glueVersion: session.GlueVersion,
    workerType: session.WorkerType,
    numberOfWorkers: session.NumberOfWorkers,
    idleTimeout: session.IdleTimeout,
    sessionType: session.SessionType,
    createdOn: session.CreatedOn,
  };
}
