import { SessionStartupFailureError } from './diagnoseStartupFailure';

export const READY_SESSION_STATES = new Set(['idle', 'busy']);
export const DEAD_SESSION_STATES = new Set(['dead', 'error', 'killed', 'shutting_down']);
export const STARTING_SESSION_STATES = new Set(['not_started', 'starting', 'recovering']);

export function isReadySessionState(state: string): boolean {
  return READY_SESSION_STATES.has(state);
}

export function isDeadSessionState(state: string): boolean {
  return DEAD_SESSION_STATES.has(state);
}

export function isStartingSessionState(state: string): boolean {
  return STARTING_SESSION_STATES.has(state);
}

/** Session is gone for good (404, entity missing, diagnosed startup death). */
export function isSessionGoneError(error: unknown): boolean {
  if (error instanceof SessionStartupFailureError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/\(404\)/.test(message)) {
    return true;
  }
  if (/EntityNotFoundException/i.test(message)) {
    return true;
  }
  if (/session\s+.*\s+not found/i.test(message)) {
    return true;
  }
  return false;
}
