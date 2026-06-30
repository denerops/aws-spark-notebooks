import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { getConfiguredAwsProfile, getConfiguredAwsRegion } from './config';

let credentialProvider: AwsCredentialIdentityProvider | undefined;
let cachedRegion: string | undefined;
let cachedRegionKey: string | undefined;
let activeCredentialProfile: string | undefined;

export function getEffectiveAwsProfile(): string {
  return getConfiguredAwsProfile() ?? process.env.AWS_PROFILE ?? 'default';
}

export function getCredentialProvider(): AwsCredentialIdentityProvider {
  const configuredProfile = getConfiguredAwsProfile();
  if (!credentialProvider || activeCredentialProfile !== configuredProfile) {
    credentialProvider = configuredProfile
      ? fromIni({ profile: configuredProfile })
      : fromNodeProviderChain();
    activeCredentialProfile = configuredProfile;
  }
  return credentialProvider;
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
