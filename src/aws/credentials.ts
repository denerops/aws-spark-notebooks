import { fromIni } from '@aws-sdk/credential-providers';
import { loadSharedConfigFiles, type ParsedIniData } from '@smithy/shared-ini-file-loader';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { getConfiguredAwsProfile, getConfiguredAwsRegion } from './config';
import {
  getCredentialProviderClientConfig,
  syncProxyEnvironmentFromSettings,
} from './proxyConfig';

let credentialProvider: AwsCredentialIdentityProvider | undefined;
let cachedRegion: string | undefined;
let cachedRegionKey: string | undefined;
let activeCredentialProfile: string | undefined;
let resolvedAutoProfile: string | undefined;
let cachedProfileProxyUrl: string | undefined;

function isSsoProfile(section: ParsedIniData[string] | undefined): boolean {
  return Boolean(section?.sso_start_url || section?.sso_session);
}

async function resolveAutoAwsProfile(): Promise<string | undefined> {
  if (getConfiguredAwsProfile() || process.env.AWS_PROFILE) {
    return undefined;
  }

  const { configFile } = await loadSharedConfigFiles();
  if (isSsoProfile(configFile.default)) {
    return 'default';
  }

  const ssoProfiles = Object.entries(configFile)
    .filter(([name, section]) => name !== 'default' && isSsoProfile(section))
    .map(([name]) => name);

  if (ssoProfiles.length === 1) {
    return ssoProfiles[0];
  }

  return undefined;
}

async function getProfileProxyUrl(profile: string): Promise<string | undefined> {
  const { configFile } = await loadSharedConfigFiles();
  const proxyUrl = configFile[profile]?.proxy_url;
  return typeof proxyUrl === 'string' && proxyUrl.trim() ? proxyUrl.trim() : undefined;
}

export async function initializeAwsContext(): Promise<void> {
  resolvedAutoProfile = await resolveAutoAwsProfile();
  const profile = getEffectiveAwsProfile();
  cachedProfileProxyUrl = await getProfileProxyUrl(profile);
  syncProxyEnvironmentFromSettings(cachedProfileProxyUrl);
  resetAwsClients();
}

export async function refreshAwsTransportContext(): Promise<void> {
  const profile = getEffectiveAwsProfile();
  cachedProfileProxyUrl = await getProfileProxyUrl(profile);
  syncProxyEnvironmentFromSettings(cachedProfileProxyUrl);
  resetAwsClients();
}

export function getEffectiveAwsProfile(): string {
  return getConfiguredAwsProfile() ?? process.env.AWS_PROFILE ?? resolvedAutoProfile ?? 'default';
}

export function getResolvedAutoProfile(): string | undefined {
  return resolvedAutoProfile;
}

export function getCredentialProvider(): AwsCredentialIdentityProvider {
  const cacheKey = getConfiguredAwsProfile() ?? process.env.AWS_PROFILE ?? resolvedAutoProfile ?? '';
  if (!credentialProvider || activeCredentialProfile !== cacheKey) {
    const profile = getEffectiveAwsProfile();
    credentialProvider = fromIni({
      profile,
      clientConfig: getCredentialProviderClientConfig(cachedProfileProxyUrl),
    });
    activeCredentialProfile = cacheKey;
  }
  return credentialProvider;
}

export function formatAwsAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!/security token|InvalidClientTokenId|ExpiredToken|expired/i.test(message)) {
    return message;
  }

  const profile = getEffectiveAwsProfile();
  return (
    `${message} — The extension is using AWS profile "${profile}". ` +
    `Select the same profile you use with \`aws sso login\` in the Config sidebar, ` +
    `then run \`aws sso login --profile ${profile}\` and reload the window.`
  );
}

export async function getDefaultRegion(): Promise<string> {
  const profile = getEffectiveAwsProfile();
  const configuredRegion = getConfiguredAwsRegion();
  const cacheKey = `${profile}:${configuredRegion ?? ''}`;
  if (cachedRegion && cachedRegionKey === cacheKey) {
    return cachedRegion;
  }

  if (configuredRegion) {
    cachedRegion = configuredRegion;
    cachedRegionKey = cacheKey;
    return configuredRegion;
  }

  const envRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (envRegion && !getConfiguredAwsProfile()) {
    cachedRegion = envRegion;
    cachedRegionKey = cacheKey;
    return cachedRegion;
  }

  const { configFile } = await loadSharedConfigFiles();
  const section = configFile[profile];
  const region = section?.region;
  if (region) {
    cachedRegion = region;
    cachedRegionKey = cacheKey;
    return cachedRegion;
  }

  if (envRegion) {
    cachedRegion = envRegion;
    cachedRegionKey = cacheKey;
    return cachedRegion;
  }

  throw new Error(
    `No AWS region found for profile "${profile}". Select a region in the Connection sidebar or set AWS_REGION / ~/.aws/config.`
  );
}

export function resetAwsClients(): void {
  credentialProvider = undefined;
  cachedRegion = undefined;
  cachedRegionKey = undefined;
  activeCredentialProfile = undefined;
}

/** @deprecated use resetAwsClients */
export function clearAwsCache(): void {
  resetAwsClients();
}
