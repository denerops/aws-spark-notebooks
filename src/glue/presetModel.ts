import { getDefaultGlueRoleArn, getGlueSessionConfigDefaults } from '../aws/glueConfig';
import { getIcebergCatalogConfig } from '../aws/icebergConfig';
import { normalizePythonPackages } from '../session/pythonPackages';
import { normalizeSparkPackages } from '../session/sparkPackages';

export type GlueWorkerType =
  | 'Standard'
  | 'G.1X'
  | 'G.2X'
  | 'G.025X'
  | 'G.4X'
  | 'G.8X'
  | 'Z.2X';

export interface GlueSessionPreset {
  id: string;
  name: string;
  /** Optional Glue session id prefix / description label. */
  sessionDescription?: string;
  roleArn: string;
  glueVersion: string;
  workerType: GlueWorkerType;
  numberOfWorkers: number;
  idleTimeout?: number;
  timeout?: number;
  pythonVersion?: string;
  /** Glue DefaultArguments (Spark conf and job args). */
  defaultArguments: Record<string, string>;
  /** Glue connection names. */
  connections?: string[];
  /** PyPI package specs installed when the session starts. */
  pythonPackages?: string[];
  /** Maven coordinates merged into spark.jars.packages. */
  sparkPackages?: string[];
  source?: GluePresetSource;
}

export type GluePresetSource = 'workspace' | 'user';

const DEFAULT_PRESET_ID = 'default';

export function createGluePresetId(): string {
  return `glue-preset-${Date.now()}`;
}

export function normalizeGluePreset(preset: GlueSessionPreset, index = 0): GlueSessionPreset {
  return {
    id: preset.id?.trim() || `glue-preset-${index + 1}`,
    name: preset.name?.trim() || `Glue Preset ${index + 1}`,
    roleArn: preset.roleArn ?? '',
    glueVersion: preset.glueVersion ?? '4.0',
    workerType: (preset.workerType ?? 'G.1X') as GlueWorkerType,
    numberOfWorkers: preset.numberOfWorkers ?? 2,
    idleTimeout: preset.idleTimeout ?? 30,
    timeout: preset.timeout,
    pythonVersion: preset.pythonVersion ?? '3',
    sessionDescription: preset.sessionDescription?.trim() || undefined,
    defaultArguments: { ...(preset.defaultArguments ?? {}) },
    connections: preset.connections?.filter(Boolean),
    pythonPackages: normalizePythonPackages(preset.pythonPackages),
    sparkPackages: normalizeSparkPackages(preset.sparkPackages),
  };
}

export function buildDefaultGlueArguments(): Record<string, string> {
  const defaults = getGlueSessionConfigDefaults();
  const fromSettings = { ...(defaults.defaultArguments ?? {}) };
  return {
    ...getIcebergCatalogConfig(),
    ...fromSettings,
  };
}

export function buildDefaultGluePreset(): GlueSessionPreset {
  const defaults = getGlueSessionConfigDefaults();
  const role = getDefaultGlueRoleArn() || '';

  return {
    id: DEFAULT_PRESET_ID,
    name: 'Default',
    roleArn: role,
    glueVersion: defaults.glueVersion ?? '4.0',
    workerType: (defaults.workerType ?? 'G.1X') as GlueWorkerType,
    numberOfWorkers: defaults.numberOfWorkers ?? 2,
    idleTimeout: defaults.idleTimeout ?? 30,
    timeout: defaults.timeout,
    pythonVersion: defaults.pythonVersion ?? '3',
    defaultArguments: buildDefaultGlueArguments(),
    pythonPackages: [],
    sparkPackages: [],
    connections: [],
  };
}

export function stripGlueRuntimeFields(preset: GlueSessionPreset): GlueSessionPreset {
  const { source: _source, ...rest } = preset;
  return rest;
}

export function createGlueSessionId(description?: string): string {
  const slug = (description ?? 'session')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Date.now().toString(36);
  return `${slug || 'session'}-${suffix}`;
}
