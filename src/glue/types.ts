export type GlueSessionStatus =
  | 'PROVISIONING'
  | 'READY'
  | 'FAILED'
  | 'TIMEOUT'
  | 'STOPPING'
  | 'STOPPED'
  | string;

export type GlueStatementState =
  | 'WAITING'
  | 'RUNNING'
  | 'AVAILABLE'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'ERROR'
  | string;

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
