import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import * as vscode from 'vscode';

type ProxySupport = 'off' | 'on' | 'override' | 'fallback';

let cachedSmithyHandler: { key: string; handler: NodeHttpHandler } | undefined;
const proxyDispatchers = new Map<string, ProxyAgent>();

function readHttpConfig() {
  return vscode.workspace.getConfiguration('http');
}

function asTrimmedString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => asStringList(entry));
  }
  const text = asTrimmedString(value);
  return text ? parseNoProxy(text) : [];
}

function envProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    undefined
  );
}

function parseNoProxy(value: string): string[] {
  return value
    .split(/[,|\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hostnameMatchesNoProxy(hostname: string, noProxy: string[]): boolean {
  const host = hostname.toLowerCase();
  for (const entry of noProxy) {
    const pattern = entry.toLowerCase();
    if (!pattern) {
      continue;
    }
    if (pattern === '*') {
      return true;
    }
    if (pattern.startsWith('.')) {
      if (host === pattern.slice(1) || host.endsWith(pattern)) {
        return true;
      }
      continue;
    }
    if (host === pattern || host.endsWith(`.${pattern}`)) {
      return true;
    }
  }
  return false;
}

function resolveProxySupport(): ProxySupport {
  const support = asTrimmedString(readHttpConfig().get<unknown>('proxySupport', 'fallback'));
  if (support === 'off' || support === 'on' || support === 'override' || support === 'fallback') {
    return support;
  }
  return 'fallback';
}

function resolveNoProxyList(): string[] {
  const fromSettings = asStringList(readHttpConfig().get<unknown>('noProxy', ''));
  if (fromSettings.length > 0) {
    return fromSettings;
  }
  const envNoProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? '';
  return parseNoProxy(asTrimmedString(envNoProxy));
}

/** Resolved proxy URL for outbound HTTPS to `hostname`, or undefined for direct connection. */
export function resolveProxyUrlForHost(hostname: string): string | undefined {
  const noProxy = resolveNoProxyList();
  if (hostnameMatchesNoProxy(hostname, noProxy)) {
    return undefined;
  }

  const vscodeProxy = asTrimmedString(readHttpConfig().get<unknown>('proxy', ''));
  const envProxy = envProxyUrl();
  const support = resolveProxySupport();

  if (support === 'off') {
    return undefined;
  }
  if (support === 'override' || support === 'on') {
    return vscodeProxy || envProxy;
  }
  return envProxy || vscodeProxy;
}

export function getProxyStrictSsl(): boolean {
  const value = readHttpConfig().get<unknown>('proxyStrictSSL', true);
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() !== 'false';
  }
  return true;
}

function tlsOptions(): { rejectUnauthorized: boolean } {
  return { rejectUnauthorized: getProxyStrictSsl() };
}

function getSmithyHandler(proxyUrl: string): NodeHttpHandler {
  const key = `${proxyUrl}|${getProxyStrictSsl()}`;
  if (cachedSmithyHandler?.key === key) {
    return cachedSmithyHandler.handler;
  }

  const options = tlsOptions();
  const handler = new NodeHttpHandler({
    httpAgent: new HttpProxyAgent(proxyUrl, options),
    httpsAgent: new HttpsProxyAgent(proxyUrl, options),
  });
  cachedSmithyHandler = { key, handler };
  return handler;
}

export function createAwsRequestHandler(hostname: string): NodeHttpHandler | undefined {
  const proxyUrl = resolveProxyUrlForHost(hostname);
  if (!proxyUrl) {
    return undefined;
  }
  return getSmithyHandler(proxyUrl);
}

export function getAwsClientTransportConfig(
  region: string
): { requestHandler: NodeHttpHandler } | Record<string, never> {
  const handler = createAwsRequestHandler(`emr-serverless.${region}.amazonaws.com`);
  return handler ? { requestHandler: handler } : {};
}

function resolveBaseProxyUrl(awsConfigProxyUrl?: string): string | undefined {
  const vscodeProxy = asTrimmedString(readHttpConfig().get<unknown>('proxy', ''));
  const envProxy = envProxyUrl();
  const support = resolveProxySupport();

  if (support === 'off') {
    return undefined;
  }
  if (support === 'override' || support === 'on') {
    return vscodeProxy || envProxy || awsConfigProxyUrl;
  }
  return envProxy || vscodeProxy || awsConfigProxyUrl;
}

/** Proxy-aware client config for SSO/STS credential refresh inside fromIni(). */
export function getCredentialProviderClientConfig(
  awsConfigProxyUrl?: string
): { requestHandler: NodeHttpHandler } | Record<string, never> {
  const proxyUrl = resolveBaseProxyUrl(awsConfigProxyUrl);
  if (!proxyUrl) {
    return {};
  }
  return { requestHandler: getSmithyHandler(proxyUrl) };
}

/**
 * Mirror VS Code / AWS CLI proxy settings into process env so Node HTTP clients
 * (including @aws-sdk/credential-providers SSO refresh) use the same proxy.
 */
export function syncProxyEnvironmentFromSettings(awsConfigProxyUrl?: string): void {
  const proxyUrl = resolveBaseProxyUrl(awsConfigProxyUrl);
  if (proxyUrl) {
    if (!process.env.HTTPS_PROXY && !process.env.https_proxy) {
      process.env.HTTPS_PROXY = proxyUrl;
    }
    if (!process.env.HTTP_PROXY && !process.env.http_proxy) {
      process.env.HTTP_PROXY = proxyUrl;
    }
  }

  const noProxy = resolveNoProxyList();
  if (noProxy.length && !process.env.NO_PROXY && !process.env.no_proxy) {
    process.env.NO_PROXY = noProxy.join(',');
  }
}

function getProxyDispatcher(proxyUrl: string): ProxyAgent {
  const key = `${proxyUrl}|${getProxyStrictSsl()}`;
  let dispatcher = proxyDispatchers.get(key);
  if (!dispatcher) {
    const tls = tlsOptions();
    dispatcher = new ProxyAgent({
      uri: proxyUrl,
      requestTls: tls,
      proxyTls: tls,
    });
    proxyDispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

/** fetch() that honors VS Code http.proxy settings and HTTP(S)_PROXY env vars. */
export async function proxiedFetch(url: string, init?: RequestInit): Promise<Response> {
  const hostname = new URL(url).hostname;
  const proxyUrl = resolveProxyUrlForHost(hostname);
  if (!proxyUrl) {
    return fetch(url, init);
  }

  const response = await undiciFetch(url, {
    method: init?.method,
    headers: init?.headers as Record<string, string> | undefined,
    body: init?.body as string | undefined,
    signal: init?.signal ?? undefined,
    dispatcher: getProxyDispatcher(proxyUrl),
  });
  return response as unknown as Response;
}

export function resetProxyConfig(): void {
  cachedSmithyHandler = undefined;
  for (const dispatcher of proxyDispatchers.values()) {
    void dispatcher.close().catch(() => undefined);
  }
  proxyDispatchers.clear();
}

export function describeProxyForHost(hostname: string): string {
  const proxyUrl = resolveProxyUrlForHost(hostname);
  if (!proxyUrl) {
    return 'direct (no proxy)';
  }
  try {
    const masked = new URL(proxyUrl);
    if (masked.password) {
      masked.password = '***';
    }
    if (masked.username) {
      masked.username = '***';
    }
    return masked.toString();
  } catch {
    return '(configured)';
  }
}
