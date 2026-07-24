import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import type { AwsCredentialIdentity } from '@smithy/types';
import { getCredentialProvider, getDefaultRegion } from '../aws/credentials';
import { proxiedFetch } from '../aws/proxyConfig';
import { livyEndpointUrl } from '../notebook/types';
import type { LivySessionInfo, LivyStatement, StatementKind } from './types';
import { parseLivySessionInfo } from './types';

export class LivySigV4Client {
  private region!: string;
  private credentials!: AwsCredentialIdentity;

  constructor(
    private readonly applicationId: string,
    region?: string
  ) {
    if (region) {
      this.region = region;
    }
  }

  private async ensureAuth(): Promise<void> {
    if (!this.region) {
      this.region = await getDefaultRegion();
    }
    const provider = getCredentialProvider();
    const creds = await provider();
    if (!creds.accessKeyId || !creds.secretAccessKey) {
      throw new Error(
        'AWS credentials not found. Configure ~/.aws/credentials, environment variables, or Config → AWS Credentials.'
      );
    }
    this.credentials = creds;
  }

  get endpoint(): string {
    return livyEndpointUrl(this.applicationId, this.region);
  }

  private async signedFetch(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    await this.ensureAuth();

    const url = `${this.endpoint}${path}`;
    const bodyText = body !== undefined ? JSON.stringify(body) : undefined;

    const request = new HttpRequest({
      method,
      protocol: 'https:',
      hostname: `${this.applicationId}.livy.emr-serverless-services.${this.region}.amazonaws.com`,
      path,
      headers: {
        'Content-Type': 'application/json',
        host: `${this.applicationId}.livy.emr-serverless-services.${this.region}.amazonaws.com`,
      },
      body: bodyText,
    });

    const signer = new SignatureV4({
      credentials: this.credentials,
      region: this.region,
      service: 'emr-serverless',
      sha256: Sha256,
    });

    const signed = await signer.sign(request);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(signed.headers)) {
      if (value !== undefined) {
        headers[key] = String(value);
      }
    }

    const response = await proxiedFetch(url, {
      method,
      headers,
      body: bodyText,
    });

    return response;
  }

  private async parseJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      let message = text || response.statusText;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) {
          message = parsed.message;
        }
      } catch {
        // use raw text
      }
      throw new Error(`Livy API error (${response.status}): ${message}`);
    }
    if (!text) {
      return {} as T;
    }
    return JSON.parse(text) as T;
  }

  async listSessions(): Promise<LivySessionInfo[]> {
    const response = await this.signedFetch('GET', '/sessions');
    const data = await this.parseJson<unknown>(response);
    const sessions = this.parseSessionsList(data);
    return Promise.all(sessions.map((session) => this.ensureSessionName(session)));
  }

  async getSession(sessionId: number): Promise<LivySessionInfo> {
    const response = await this.signedFetch('GET', `/sessions/${sessionId}`);
    const data = await this.parseJson<unknown>(response);
    const parsed = parseLivySessionInfo(data);
    if (!parsed) {
      throw new Error(`Invalid session response for session ${sessionId}`);
    }
    return parsed;
  }

  async createSession(body: Record<string, unknown>): Promise<LivySessionInfo> {
    const response = await this.signedFetch('POST', '/sessions', body);
    const data = await this.parseJson<unknown>(response);
    const parsed = parseLivySessionInfo(data);
    if (!parsed) {
      throw new Error('Invalid session response from Livy create session');
    }
    return parsed;
  }

  private parseSessionsList(data: unknown): LivySessionInfo[] {
    let raw: unknown[] = [];
    if (Array.isArray(data)) {
      raw = data;
    } else if (
      data &&
      typeof data === 'object' &&
      Array.isArray((data as { sessions?: unknown[] }).sessions)
    ) {
      raw = (data as { sessions: unknown[] }).sessions;
    }

    return raw
      .map((entry) => parseLivySessionInfo(entry))
      .filter((session): session is LivySessionInfo => session !== undefined);
  }

  private async ensureSessionName(session: LivySessionInfo): Promise<LivySessionInfo> {
    if (session.name?.trim()) {
      return session;
    }

    try {
      const detail = await this.getSession(session.id);
      const name = detail.name?.trim();
      return name ? { ...session, name } : session;
    } catch {
      return session;
    }
  }

  async deleteSession(sessionId: number): Promise<void> {
    const response = await this.signedFetch('DELETE', `/sessions/${sessionId}`);
    await this.parseJson(response);
  }

  async submitStatement(
    sessionId: number,
    code: string,
    kind?: StatementKind
  ): Promise<LivyStatement> {
    const payload: Record<string, unknown> = { code };
    if (kind) {
      payload.kind = kind;
    }
    const response = await this.signedFetch('POST', `/sessions/${sessionId}/statements`, payload);
    return this.parseJson<LivyStatement>(response);
  }

  async getStatement(sessionId: number, statementId: number): Promise<LivyStatement> {
    const response = await this.signedFetch(
      'GET',
      `/sessions/${sessionId}/statements/${statementId}`
    );
    return this.parseJson<LivyStatement>(response);
  }

  async cancelStatement(sessionId: number, statementId: number): Promise<void> {
    const response = await this.signedFetch(
      'POST',
      `/sessions/${sessionId}/statements/${statementId}/cancel`
    );
    await this.parseJson(response);
  }

  async pollStatementUntilDone(
    sessionId: number,
    statementId: number,
    options: {
      pollIntervalMs: number;
      signal?: AbortSignal;
      onStatement?: (stmt: LivyStatement) => void;
    }
  ): Promise<LivyStatement> {
    const terminal = new Set(['available', 'error', 'cancelled']);

    while (true) {
      if (options.signal?.aborted) {
        throw new Error('Execution cancelled');
      }

      const stmt = await this.getStatement(sessionId, statementId);
      options.onStatement?.(stmt);

      if (terminal.has(stmt.state)) {
        return stmt;
      }

      await sleep(options.pollIntervalMs, options.signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Execution cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Execution cancelled'));
      },
      { once: true }
    );
  });
}
