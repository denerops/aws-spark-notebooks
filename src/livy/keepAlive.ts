/** Default Livy orphan timeout we send on POST /sessions (seconds). */
export const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 60;

/**
 * Ping interval for POST /sessions/{id}/heartbeat.
 * Livy orphans the session if no heartbeat arrives within heartbeatTimeoutInSecond.
 */
export function keepAliveIntervalMs(heartbeatTimeoutInSecond: number): number {
  if (!Number.isFinite(heartbeatTimeoutInSecond) || heartbeatTimeoutInSecond <= 0) {
    return 0;
  }
  return Math.max(5_000, Math.floor((heartbeatTimeoutInSecond * 1000) / 3));
}
