import {
  GlueClient,
  CreateSessionCommand,
  GetSessionCommand,
  ListSessionsCommand,
  StopSessionCommand,
  DeleteSessionCommand,
  RunStatementCommand,
  GetStatementCommand,
  CancelStatementCommand,
  GetDashboardUrlCommand,
  type WorkerType,
} from '@aws-sdk/client-glue';
import { getConfiguredAwsProfile } from '../aws/config';
import { getCredentialProvider, getDefaultRegion } from '../aws/credentials';
import { getAwsClientTransportConfig } from '../aws/proxyConfig';
import { GLUE_REQUEST_ORIGIN } from '../aws/glueConfig';
import { mapGlueSession, type GlueSessionSummary } from './types';

export interface CreateGlueSessionInput {
  id: string;
  description?: string;
  role: string;
  glueVersion: string;
  workerType: WorkerType;
  numberOfWorkers: number;
  idleTimeout?: number;
  timeout?: number;
  pythonVersion?: string;
  defaultArguments?: Record<string, string>;
  connections?: string[];
}

export class GlueInteractiveSessionService {
  private client: GlueClient | undefined;
  private region!: string;
  private activeProfile: string | undefined;

  private async getClient(): Promise<GlueClient> {
    const configuredProfile = getConfiguredAwsProfile();
    const region = await getDefaultRegion();
    if (
      !this.client ||
      this.activeProfile !== configuredProfile ||
      this.region !== region
    ) {
      this.region = region;
      this.client = new GlueClient({
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

  async listLivySessions(): Promise<GlueSessionSummary[]> {
    const client = await this.getClient();
    const sessions: GlueSessionSummary[] = [];
    let nextToken: string | undefined;

    do {
      const response = await client.send(
        new ListSessionsCommand({
          MaxResults: 100,
          NextToken: nextToken,
          RequestOrigin: GLUE_REQUEST_ORIGIN,
        })
      );

      for (const session of response.Sessions ?? []) {
        if (session.SessionType && session.SessionType !== 'LIVY') {
          continue;
        }
        sessions.push(mapGlueSession(session));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return sessions.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getSession(sessionId: string): Promise<GlueSessionSummary> {
    const client = await this.getClient();
    const response = await client.send(
      new GetSessionCommand({
        Id: sessionId,
        RequestOrigin: GLUE_REQUEST_ORIGIN,
      })
    );
    if (!response.Session) {
      throw new Error(`Glue session ${sessionId} not found`);
    }
    return mapGlueSession(response.Session);
  }

  async createSession(input: CreateGlueSessionInput): Promise<GlueSessionSummary> {
    const client = await this.getClient();
    const response = await client.send(
      new CreateSessionCommand({
        Id: input.id,
        Description: input.description,
        Role: input.role,
        SessionType: 'LIVY',
        GlueVersion: input.glueVersion,
        WorkerType: input.workerType,
        NumberOfWorkers: input.numberOfWorkers,
        IdleTimeout: input.idleTimeout,
        Timeout: input.timeout,
        DefaultArguments: input.defaultArguments,
        Command: {
          Name: 'glueetl',
          PythonVersion: input.pythonVersion ?? '3',
        },
        ...(input.connections?.length
          ? { Connections: { Connections: input.connections } }
          : {}),
        RequestOrigin: GLUE_REQUEST_ORIGIN,
      })
    );
    if (!response.Session?.Id) {
      throw new Error('Glue CreateSession returned no session');
    }
    return mapGlueSession(response.Session);
  }

  async waitForSessionReady(sessionId: string, timeoutMs: number): Promise<GlueSessionSummary> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const session = await this.getSession(sessionId);
      if (session.status === 'READY') {
        return session;
      }
      if (session.status === 'FAILED' || session.status === 'TIMEOUT' || session.status === 'STOPPED') {
        throw new Error(`Glue session failed to start (status: ${session.status})`);
      }
      await sleep(3000);
    }
    throw new Error(`Timed out waiting for Glue session ${sessionId} to become READY`);
  }

  async stopSession(sessionId: string): Promise<void> {
    const client = await this.getClient();
    await client.send(
      new StopSessionCommand({
        Id: sessionId,
        RequestOrigin: GLUE_REQUEST_ORIGIN,
      })
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const client = await this.getClient();
    await client.send(
      new DeleteSessionCommand({
        Id: sessionId,
        RequestOrigin: GLUE_REQUEST_ORIGIN,
      })
    );
  }

  async runStatement(sessionId: string, code: string): Promise<number> {
    const client = await this.getClient();
    const response = await client.send(
      new RunStatementCommand({
        SessionId: sessionId,
        Code: code,
        RequestOrigin: GLUE_REQUEST_ORIGIN,
      })
    );
    if (response.Id === undefined) {
      throw new Error('Glue RunStatement returned no statement id');
    }
    return response.Id;
  }

  async getStatement(sessionId: string, statementId: number) {
    const client = await this.getClient();
    const response = await client.send(
      new GetStatementCommand({
        SessionId: sessionId,
        Id: statementId,
        RequestOrigin: GLUE_REQUEST_ORIGIN,
      })
    );
    if (!response.Statement) {
      throw new Error(`Glue statement ${statementId} not found`);
    }
    return response.Statement;
  }

  async cancelStatement(sessionId: string, statementId: number): Promise<void> {
    const client = await this.getClient();
    await client.send(
      new CancelStatementCommand({
        SessionId: sessionId,
        Id: statementId,
        RequestOrigin: GLUE_REQUEST_ORIGIN,
      })
    );
  }

  async getDashboardUrl(sessionId: string): Promise<string | undefined> {
    const client = await this.getClient();
    try {
      const response = await client.send(
        new GetDashboardUrlCommand({
          ResourceId: sessionId,
          ResourceType: 'SESSION',
          RequestOrigin: GLUE_REQUEST_ORIGIN,
        })
      );
      return response.Url;
    } catch {
      return undefined;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let sharedService: GlueInteractiveSessionService | undefined;

export function resetGlueSessionService(): void {
  sharedService = undefined;
}

export function getGlueSessionService(): GlueInteractiveSessionService {
  if (!sharedService) {
    sharedService = new GlueInteractiveSessionService();
  }
  return sharedService;
}
