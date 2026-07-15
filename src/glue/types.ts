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

const TERMINAL_OUTPUT_STATUSES = new Set(['available', 'ok', 'error', 'cancelled']);

function glueOutputStatus(raw: Statement): string | undefined {
  return raw.Output?.Status ? mapGlueStatementState(raw.Output.Status) : undefined;
}

function glueStatementState(raw: Statement): string | undefined {
  return raw.State ? mapGlueStatementState(raw.State) : undefined;
}

export function hasGlueStatementError(raw: Statement): boolean {
  const output = raw.Output;
  return Boolean(
    glueOutputStatus(raw) === 'error' ||
      glueStatementState(raw) === 'error' ||
      output?.ErrorName ||
      output?.ErrorValue ||
      (output?.Traceback?.length ?? 0) > 0
  );
}

/**
 * Glue exposes progress on Statement.State and result readiness on Output.Status.
 * Statement.State can flip to AVAILABLE before Output.Data.TextPlain is populated.
 */
export function isGlueStatementTerminal(raw: Statement): boolean {
  const statementState = glueStatementState(raw);
  const outputStatus = glueOutputStatus(raw);

  if (outputStatus === 'error' || outputStatus === 'cancelled') {
    return true;
  }
  if (statementState === 'error' || statementState === 'cancelled') {
    return true;
  }
  if (outputStatus && TERMINAL_OUTPUT_STATUSES.has(outputStatus)) {
    return true;
  }
  if (hasGlueStatementError(raw)) {
    return true;
  }
  return false;
}

export function resolveGlueStatementStatus(raw: Statement): string {
  const statementState = glueStatementState(raw);
  const outputStatus = glueOutputStatus(raw);

  if (hasGlueStatementError(raw)) {
    return 'error';
  }
  if (outputStatus === 'cancelled' || statementState === 'cancelled') {
    return 'cancelled';
  }
  if (outputStatus === 'available' || outputStatus === 'ok') {
    return 'available';
  }
  if (statementState && TERMINAL_STATEMENT_STATES.has(statementState)) {
    return statementState;
  }
  if (outputStatus && TERMINAL_OUTPUT_STATUSES.has(outputStatus)) {
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
