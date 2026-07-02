import * as vscode from 'vscode';

export interface GlueSessionConfigDefaults {
  glueVersion?: string;
  workerType?: string;
  numberOfWorkers?: number;
  idleTimeout?: number;
  timeout?: number;
  pythonVersion?: string;
  defaultArguments?: Record<string, string>;
}

export function getGlueExtensionConfig() {
  return vscode.workspace.getConfiguration('glueInteractive');
}

export function getDefaultGlueRoleArn(): string {
  return getGlueExtensionConfig().get<string>('defaultRoleArn', '');
}

export function getGlueSessionConfigDefaults(): GlueSessionConfigDefaults {
  return getGlueExtensionConfig().get<GlueSessionConfigDefaults>('sessionDefaults', {});
}

export function getGlueStatementPollIntervalMs(): number {
  return getGlueExtensionConfig().get<number>(
    'statementPollIntervalMs',
    vscode.workspace.getConfiguration('emrServerless').get<number>('statementPollIntervalMs', 500)
  );
}

export function getGlueSessionStartupTimeoutSeconds(): number {
  return getGlueExtensionConfig().get<number>(
    'sessionStartupTimeoutSeconds',
    vscode.workspace.getConfiguration('emrServerless').get<number>('sessionStartupTimeoutSeconds', 600)
  );
}

export const GLUE_REQUEST_ORIGIN = 'aws-spark-notebooks';
