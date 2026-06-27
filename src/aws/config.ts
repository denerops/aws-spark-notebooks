import * as vscode from 'vscode';

export interface SessionConfigDefaults {
  driverMemory?: string;
  executorMemory?: string;
  executorCores?: number;
  numExecutors?: number;
  heartbeatTimeoutInSecond?: number;
  ttl?: string;
  conf?: Record<string, string>;
}

export function getExtensionConfig() {
  return vscode.workspace.getConfiguration('emrServerless');
}

export function getDefaultExecutionRoleArn(): string {
  return getExtensionConfig().get<string>('defaultExecutionRoleArn', '');
}

export function getSessionConfigDefaults(): SessionConfigDefaults {
  return getExtensionConfig().get<SessionConfigDefaults>('sessionConfigsDefaults', {});
}

export function getStatementPollIntervalMs(): number {
  return getExtensionConfig().get<number>('statementPollIntervalMs', 500);
}

export function getSessionStartupTimeoutSeconds(): number {
  return getExtensionConfig().get<number>('sessionStartupTimeoutSeconds', 600);
}

export function getMaxRows(): number {
  return getExtensionConfig().get<number>('maxRows', 1000);
}

export function getConfiguredAwsProfile(): string | undefined {
  const configured = getExtensionConfig().get<string>('awsProfile', '').trim();
  return configured || undefined;
}

export { buildCreateSessionBody } from '../session/buildSessionBody';
