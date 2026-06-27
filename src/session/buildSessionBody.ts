import { getIcebergCatalogConfig } from '../aws/icebergConfig';
import { getDefaultExecutionRoleArn, getSessionConfigDefaults } from '../aws/config';
import type { SessionPreset } from './presets';

export function buildCreateSessionBody(
  preset?: SessionPreset,
  options?: { sessionName?: string }
): Record<string, unknown> {
  if (preset) {
    return buildFromPreset(preset, options?.sessionName);
  }
  return buildFromSettings(options?.sessionName);
}

function resolveSessionName(
  preset: SessionPreset | undefined,
  sessionName?: string
): string | undefined {
  const explicit = sessionName?.trim();
  if (explicit) {
    return explicit;
  }
  return preset?.livySessionName?.trim() || undefined;
}

function buildFromPreset(preset: SessionPreset, sessionName?: string): Record<string, unknown> {
  const conf = {
    ...getIcebergCatalogConfig(),
    ...preset.sparkConf,
  };
  if (preset.executionRoleArn) {
    conf['emr-serverless.session.executionRoleArn'] = preset.executionRoleArn;
  }

  const name = resolveSessionName(preset, sessionName);

  return {
    kind: 'pyspark',
    ...(name ? { name } : {}),
    driverMemory: preset.driverMemory,
    executorMemory: preset.executorMemory,
    executorCores: preset.executorCores,
    numExecutors: preset.numExecutors,
    ...(preset.driverCores ? { driverCores: preset.driverCores } : {}),
    heartbeatTimeoutInSecond: preset.heartbeatTimeoutInSecond ?? 60,
    ...(preset.ttl ? { ttl: preset.ttl } : {}),
    conf,
  };
}

function buildFromSettings(sessionName?: string): Record<string, unknown> {
  const defaults = getSessionConfigDefaults();
  const roleArn = getDefaultExecutionRoleArn();
  const conf = {
    ...getIcebergCatalogConfig(),
    ...(defaults.conf ?? {}),
  };
  if (roleArn) {
    conf['emr-serverless.session.executionRoleArn'] = roleArn;
  }

  const name = sessionName?.trim();

  return {
    kind: 'pyspark',
    ...(name ? { name } : {}),
    driverMemory: defaults.driverMemory,
    executorMemory: defaults.executorMemory,
    executorCores: defaults.executorCores,
    numExecutors: defaults.numExecutors,
    heartbeatTimeoutInSecond: defaults.heartbeatTimeoutInSecond ?? 60,
    ...(defaults.ttl ? { ttl: defaults.ttl } : {}),
    conf,
  };
}
