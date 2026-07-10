import {
  EMRServerlessClient,
  GetApplicationCommand,
  GetDashboardForJobRunCommand,
  GetResourceDashboardCommand,
  ListApplicationsCommand,
  StartApplicationCommand,
  StopApplicationCommand,
  type Application,
} from '@aws-sdk/client-emr-serverless';
import { getConfiguredAwsProfile } from './config';
import { getCredentialProvider, getDefaultRegion } from './credentials';
import { getAwsClientTransportConfig } from './proxyConfig';
import { LivySigV4Client } from '../livy/sigV4Client';

export interface SparkDashboardResult {
  url?: string;
  error?: string;
}

export interface LivyApplication {
  id: string;
  name: string;
  state: string;
  releaseLabel?: string;
  livyEndpointEnabled: boolean;
}

export class EmrServerlessService {
  private client: EMRServerlessClient | undefined;
  private region!: string;
  private activeProfile: string | undefined;

  private async getClient(): Promise<EMRServerlessClient> {
    const configuredProfile = getConfiguredAwsProfile();
    const region = await getDefaultRegion();
    if (
      !this.client ||
      this.activeProfile !== configuredProfile ||
      this.region !== region
    ) {
      this.region = region;
      this.client = new EMRServerlessClient({
        region: this.region,
        credentials: getCredentialProvider(),
        ...getAwsClientTransportConfig(this.region),
      });
      this.activeProfile = configuredProfile;
    }
    return this.client;
  }

  async getRegion(): Promise<string> {
    await this.getClient();
    return this.region;
  }

  async listLivyApplications(): Promise<LivyApplication[]> {
    const client = await this.getClient();
    const apps: LivyApplication[] = [];
    let nextToken: string | undefined;

    do {
      const response = await client.send(
        new ListApplicationsCommand({
          maxResults: 50,
          nextToken,
        })
      );

      for (const summary of response.applications ?? []) {
        if (!summary.id) {
          continue;
        }
        const detail = await this.getApplication(summary.id);
        if (detail?.livyEndpointEnabled) {
          apps.push(detail);
        }
      }

      nextToken = response.nextToken;
    } while (nextToken);

    return apps;
  }

  async getApplication(applicationId: string): Promise<LivyApplication | undefined> {
    const client = await this.getClient();
    const response = await client.send(
      new GetApplicationCommand({ applicationId })
    );
    return mapApplication(response.application, applicationId);
  }

  async startApplication(
    applicationId: string,
    onProgress?: (state: string) => void
  ): Promise<void> {
    const client = await this.getClient();
    await client.send(new StartApplicationCommand({ applicationId }));
    onProgress?.('STARTING');
    await this.waitForApplicationState(applicationId, 'STARTED', 600_000, onProgress);
  }

  async stopApplication(
    applicationId: string,
    onProgress?: (state: string) => void
  ): Promise<void> {
    const client = await this.getClient();
    await client.send(new StopApplicationCommand({ applicationId }));
    onProgress?.('STOPPING');
    await this.waitForApplicationState(applicationId, 'STOPPED', 600_000, onProgress);
  }

  async restartApplication(
    applicationId: string,
    onProgress?: (state: string) => void
  ): Promise<void> {
    await this.stopApplication(applicationId, onProgress);
    await this.startApplication(applicationId, onProgress);
  }

  async getResourceDashboard(applicationId: string, sessionId: number): Promise<string | undefined> {
    const result = await this.getSparkDashboardUrl(applicationId, sessionId);
    return result.url;
  }

  /**
   * Resolve Spark UI URL for a Livy interactive session.
   * Tries GetDashboardForJobRun (Livy) then GetResourceDashboard (Spark Connect).
   */
  async getSparkDashboardUrl(
    applicationId: string,
    livySessionId: number,
    options?: { sparkAppId?: string }
  ): Promise<SparkDashboardResult> {
    const client = await this.getClient();
    const errors: string[] = [];

    let sparkAppId = options?.sparkAppId;
    if (!sparkAppId) {
      try {
        const region = await this.getRegion();
        const livy = new LivySigV4Client(applicationId, region);
        const info = await livy.getSession(livySessionId);
        sparkAppId = info.appId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Livy getSession: ${message}`);
      }
    }

    const jobRunCandidates = [
      sparkAppId,
      String(livySessionId),
    ].filter((id, index, arr): id is string => Boolean(id) && arr.indexOf(id) === index);

    for (const jobRunId of jobRunCandidates) {
      try {
        const response = await client.send(
          new GetDashboardForJobRunCommand({
            applicationId,
            jobRunId,
          })
        );
        if (response.url) {
          return { url: response.url };
        }
        errors.push(`GetDashboardForJobRun(${jobRunId}): empty url`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`GetDashboardForJobRun(${jobRunId}): ${message}`);
      }
    }

    try {
      const response = await client.send(
        new GetResourceDashboardCommand({
          applicationId,
          resourceId: String(livySessionId),
          resourceType: 'SESSION',
        })
      );
      if (response.url) {
        return { url: response.url };
      }
      errors.push('GetResourceDashboard: empty url');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`GetResourceDashboard: ${message}`);
    }

    return { error: errors.join(' | ') };
  }

  async waitForApplicationState(
    applicationId: string,
    targetState: string,
    timeoutMs = 600_000,
    onProgress?: (state: string) => void
  ): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const app = await this.getApplication(applicationId);
      const state = app?.state ?? 'UNKNOWN';
      onProgress?.(state);
      if (state === targetState) {
        return;
      }
      if (targetState === 'STARTED' && state === 'STARTING') {
        await sleep(3000);
        continue;
      }
      if (targetState === 'STOPPED' && (state === 'STOPPING' || state === 'STARTED')) {
        await sleep(3000);
        continue;
      }
      await sleep(2000);
    }
    throw new Error(`Timed out waiting for application ${applicationId} to reach ${targetState}`);
  }
}

function mapApplication(app: Application | undefined, fallbackId: string): LivyApplication | undefined {
  if (!app) {
    return undefined;
  }
  const id = app.applicationId ?? fallbackId;
  const livyEnabled = app.interactiveConfiguration?.livyEndpointEnabled === true;
  return {
    id,
    name: app.name ?? id,
    state: app.state ?? 'UNKNOWN',
    releaseLabel: app.releaseLabel,
    livyEndpointEnabled: livyEnabled,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let sharedService: EmrServerlessService | undefined;

export function resetEmrServerlessService(): void {
  sharedService = undefined;
}

export function getEmrServerlessService(): EmrServerlessService {
  if (!sharedService) {
    sharedService = new EmrServerlessService();
  }
  return sharedService;
}
