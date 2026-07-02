import { applySparkPackagesToConf } from '../session/sparkPackages';
import type { CreateGlueSessionInput } from './glueSessionService';
import type { WorkerType } from '@aws-sdk/client-glue';
import { buildDefaultGluePreset, createGlueSessionId, type GlueSessionPreset } from './presetModel';

export function buildCreateGlueSessionInput(
  preset?: GlueSessionPreset,
  options?: { sessionName?: string; sessionId?: string }
): CreateGlueSessionInput {
  if (preset) {
    return buildFromPreset(preset, options);
  }
  return buildFromPreset(buildDefaultGluePreset(), options);
}

function buildFromPreset(
  preset: GlueSessionPreset,
  options?: { sessionName?: string; sessionId?: string }
): CreateGlueSessionInput {
  const defaultArguments = { ...preset.defaultArguments };
  applySparkPackagesToConf(defaultArguments, preset.sparkPackages);

  const description = options?.sessionName?.trim() || preset.sessionDescription?.trim();
  const id = options?.sessionId ?? createGlueSessionId(description);

  return {
    id,
    description,
    role: preset.roleArn,
    glueVersion: preset.glueVersion,
    workerType: preset.workerType as WorkerType,
    numberOfWorkers: preset.numberOfWorkers,
    idleTimeout: preset.idleTimeout,
    timeout: preset.timeout,
    pythonVersion: preset.pythonVersion,
    defaultArguments,
    connections: preset.connections,
    tags: preset.tags,
  };
}
