import { getDefaultExecutionRoleArn, getSessionConfigDefaults } from '../aws/config';
import { getIcebergCatalogConfig } from '../aws/icebergConfig';
import { normalizePythonPackages } from './pythonPackages';

export interface SessionPreset {
  id: string;
  name: string;
  /** Optional Livy session name (shown in the EMR Serverless sidebar). */
  livySessionName?: string;
  executionRoleArn: string;
  driverMemory: string;
  executorMemory: string;
  executorCores: number;
  numExecutors: number;
  driverCores?: number;
  heartbeatTimeoutInSecond?: number;
  ttl?: string;
  /** Spark / Livy conf entries (excluding execution role). */
  sparkConf: Record<string, string>;
  /** PyPI package specs installed with pip when the session starts. */
  pythonPackages?: string[];
  /** Set when listing presets; not persisted to storage. */
  source?: SessionPresetSource;
}

export type SessionPresetSource = 'workspace' | 'user';

const DEFAULT_PRESET_ID = 'default';

export function createPresetId(): string {
  return `preset-${Date.now()}`;
}

export function normalizePreset(preset: SessionPreset, index = 0): SessionPreset {
  return {
    id: preset.id?.trim() || `preset-${index + 1}`,
    name: preset.name?.trim() || `Preset ${index + 1}`,
    executionRoleArn: preset.executionRoleArn ?? '',
    driverMemory: preset.driverMemory ?? '4G',
    executorMemory: preset.executorMemory ?? '16G',
    executorCores: preset.executorCores ?? 4,
    numExecutors: preset.numExecutors ?? 1,
    driverCores: preset.driverCores,
    heartbeatTimeoutInSecond: preset.heartbeatTimeoutInSecond ?? 60,
    ttl: preset.ttl,
    livySessionName: preset.livySessionName?.trim() || undefined,
    sparkConf: { ...(preset.sparkConf ?? {}) },
    pythonPackages: normalizePythonPackages(preset.pythonPackages),
  };
}

/** Spark conf seeded into new presets and the built-in Default preset. */
export function buildDefaultSparkConf(): Record<string, string> {
  const defaults = getSessionConfigDefaults();
  const fromSettings = { ...(defaults.conf ?? {}) };
  delete fromSettings['emr-serverless.session.executionRoleArn'];

  return {
    ...getIcebergCatalogConfig(),
    ...fromSettings,
  };
}

export function buildDefaultPreset(): SessionPreset {
  const defaults = getSessionConfigDefaults();
  const role =
    getDefaultExecutionRoleArn() ||
    defaults.conf?.['emr-serverless.session.executionRoleArn'] ||
    '';

  return {
    id: DEFAULT_PRESET_ID,
    name: 'Default',
    executionRoleArn: role,
    driverMemory: defaults.driverMemory ?? '4G',
    executorMemory: defaults.executorMemory ?? '16G',
    executorCores: defaults.executorCores ?? 4,
    numExecutors: defaults.numExecutors ?? 1,
    heartbeatTimeoutInSecond: defaults.heartbeatTimeoutInSecond ?? 60,
    ttl: defaults.ttl,
    sparkConf: buildDefaultSparkConf(),
    pythonPackages: [],
  };
}

export function stripRuntimeFields(preset: SessionPreset): SessionPreset {
  const { source: _source, ...rest } = preset;
  return rest;
}
