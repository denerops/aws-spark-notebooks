import { fromEnv, fromIni } from '@aws-sdk/credential-providers';
import { loadSharedConfigFiles, type ParsedIniData } from '@smithy/shared-ini-file-loader';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { getConfiguredAwsProfile, getConfiguredAwsRegion } from './config';
import { getExtensionCredentials } from './extensionCredentials';
import {
  getCredentialProviderClientConfig,
  syncProxyEnvironmentFromSettings,
} from './proxyConfig';

let credentialProvider: AwsCredentialIdentityProvider | undefined;
let cachedRegion: string | undefined;
let cachedRegionKey: string | undefined;
let activeCredentialCacheKey: string | undefined;
let resolvedAutoProfile: string | undefined;
let cachedProfileProxyUrl: string | undefined;

/**
 * On Windows, some shells set HOME to a non-USERPROFILE path (Git Bash, WSL
 * exports). Prefer USERPROFILE when HOME does not point at a usable .aws dir.
 */
function normalizeWindowsAwsHome(): void {
  if (process.platform !== 'win32') {
    return;
  }
  const userProfile = process.env.USERPROFILE?.trim();
  if (!userProfile) {
    return;
  }
  const home = process.env.HOME?.trim();
  if (!home || home === userProfile) {
    if (!home) {
      process.env.HOME = userProfile;
    }
    return;
  }
  // If HOME looks like a Unix /mnt/c/... or /home/... path under Windows Node,
  // fall back to USERPROFILE so shared-ini-file-loader finds %USERPROFILE%\.aws.
  if (home.startsWith('/') || home.includes('/mnt/')) {
    process.env.HOME = userProfile;
  }
}

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
  normalizeWindowsAwsHome();
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
  const profileCacheKey =
    getConfiguredAwsProfile() ?? process.env.AWS_PROFILE ?? resolvedAutoProfile ?? '';
  // Extension credentials are resolved lazily inside the provider so SecretStorage
  // can be async without making every caller await.
  const provider: AwsCredentialIdentityProvider = async () => {
    const extensionCreds = await getExtensionCredentials();
    if (extensionCreds) {
      return extensionCreds;
    }

    const profile = getEffectiveAwsProfile();
    const iniProvider = fromIni({
      profile,
      clientConfig: getCredentialProviderClientConfig(cachedProfileProxyUrl),
    });
    try {
      return await iniProvider();
    } catch (iniError) {
      // Windows / GUI-launched hosts often miss ~/.aws; env vars still work.
      try {
        return await fromEnv()();
      } catch {
        throw iniError;
      }
    }
  };

  if (!credentialProvider || activeCredentialCacheKey !== profileCacheKey) {
    credentialProvider = provider;
    activeCredentialCacheKey = profileCacheKey;
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
    `then run \`aws sso login --profile ${profile}\` and reload the window. ` +
    `On Windows, if ~/.aws is not visible to the extension host, use Config → AWS Credentials to paste access keys.`
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
  activeCredentialCacheKey = undefined;
}

/** @deprecated use resetAwsClients */
export function clearAwsCache(): void {
  resetAwsClients();
}
